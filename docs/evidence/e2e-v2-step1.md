# E2E 证据 — v2.0 第 1 步：引擎并入插件

日期：2026-10-03 14:10–14:25 +0900
被测：工作副本 `~/dev/plugins/dsh-cold-backup`（提交前的树；`package.json` 版本仍是 `1.1.1`，
发版时才提到 `1.2.0`）
方法：**一次性 profile**（`cb-e2e`，`--from-default-profile web` 生成）装在真实 `DSH_HOME` 里，
宿主跑在独立端口 `19998`，**全程不碰在用的 `desktop` profile**；验收完把宿主停掉、profile 删掉、
全局 CLI 装回（见第 7 节）。

验收标准来自 [`plan-2.0.md`](../plan-2.0.md) §3。

## 1. A1 — 单测

```
$ npm test
ℹ tests 37
ℹ pass 37
ℹ fail 0
```

新增 9 项：引擎解析 4 项（依赖 / PATH / 两种「缺失」/ 不支持的平台）、采集器 4 项
（固定 argv、配置命令优先、`bundledEngine:false` 完全被动、引擎缺失时的 reason）、
以及客户端渲染出「引擎」一行。

## 2. A4 — 打包纯净（单一事实源）

```
$ npm pack
dsh-cold-backup-1.1.1.tgz        # 8 个文件
$ tar -tzf dsh-cold-backup-1.1.1.tgz | grep -c 'bin/cold-backup'
0
```

包内只有 `index.js`/`engine.js`/`client.js`/`cordis.patch.yml`/两个 README/LICENSE ——
引擎靠依赖装进来，**没有任何副本**。

## 3. 装一次就带引擎（这条是「不必再装 CLI」的核心）

先试 `add <本地目录>`（`link:` 安装）：**依赖不会跟着装** —— pnpm 对被链接的包只用它自己仓库里的
`node_modules`。所以验收改走真实安装路径：

```
$ dsh plugin --profile cb-e2e add ./dsh-cold-backup-1.1.1.tgz
Packages: +2
Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml: cold-backup@1.0.3
Done in 818ms using pnpm v11.7.0

$ ls ~/.dsh/profiles/cb-e2e/node_modules/cold-backup/bin/cold-backup
-rwxr-xr-x  79581  .../node_modules/cold-backup/bin/cold-backup
```

**一次安装 = 插件 + 引擎。**（`link:` 的差异已写进 `AGENTS.md` 的硬约束里。）

## 4. A2 — 路由给出的判定来自自带依赖

```
$ curl -s http://127.0.0.1:19998/dsh-cold-backup/status
level                : ok
engineSource         : dependency
engineVersion        : 1.0.3
enginePath           : /Users/lu.haotian/.dsh/profiles/cb-e2e/node_modules/dsh-cold-backup/node_modules/cold-backup/bin/cold-backup
document.schema      : cold-backup.status/1
document.verdict     : ok
targets              : 17
config.bundledEngine : true
```

`enginePath` 落在 pnpm 的嵌套布局里（`dsh-cold-backup/node_modules/cold-backup`），说明解析是
**从本包出发**、而不是碰巧命中 PATH —— 这正是契约要的。

## 5. A5 — 仍然只读

```
$ curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:19998/dsh-cold-backup/status
405
```

第 1 步没有引入任何动作路由，动词限制原样保留。

## 6. A3 — 没有全局 CLI 时，提交仍然触发冷备

```sh
npm rm -g cold-backup         # 卸掉全局 CLI
ls /opt/homebrew/bin/cold-backup   # → No such file or directory
command -v cold-backup        # → /Users/lu.haotian/.local/bin/cold-backup（shim）
cold-backup --version         # → cold-backup 1.0.3
git -C ~/dev/cold-backup commit --allow-empty -m "e2e: hook fires with no global CLI (temp)"
```

钩子起来之后（进程行里就是 profile 里那份引擎）：

```
$ pgrep -fl cold-backup
73017 /bin/bash /Users/lu.haotian/.dsh/profiles/cb-e2e/node_modules/cold-backup/bin/cold-backup --trigger=post-commit

$ grep 'trigger=post-commit' ~/Library/Logs/cold-backup/backup.log | tail -2
[2026-10-03 14:05:01] (post-commit) 开始备份：trigger=post-commit dest=…/dev-backup
[2026-10-03 14:18:06] (post-commit) 开始备份：trigger=post-commit dest=…/dev-backup

$ tail -1 ~/Library/Logs/cold-backup/backup.log
[2026-10-03 14:19:02] (post-commit) 备份结束：仓库=7

$ cat ~/Library/Logs/cold-backup/last-ok   # 14:05:58 → 14:19:02
```

**验收通过**：链路是 提交 → `post-commit` → shim → profile 里的引擎 → 一轮完整备份。
临时提交随后用 `git reset --hard HEAD~1` 撤销（`HEAD` 回到 `97d5ab2`，工作区干净）。

## 7. A6 — 引擎缺失时：不误报，也不假绿

三种情形（全局 CLI 已卸、profile 里的引擎已移走）：

| 情形 | engineSource | engineMissing | level | reasons | 结论 |
|---|---|---|---|---|---|
| (a) PATH 上还有 shim（它自己能起来，但引擎没了 → 退出 127） | `path` | false | bad | `status-json-failed` | **「配了但用不了」**，不是「没配」—— 设计使然 |
| (b) 哪都没有引擎，但有新鲜的成功记录 | `null` | true | ok | `[]` | 不误报 |
| (c) 哪都没有引擎，而且没有任何来源（全新安装的样子） | `null` | true | bad | `engine-missing`, `freshness-missing` | **点名「找不到引擎」** |

(c) 里 `explicitlyConfigured` 是 `true`，因为我为了造场景把 `freshnessFile` 指到了不存在的路径；
真实的全新安装用的是出厂默认值，该标志为 `false`，面板会同时给出「尚未配置」的安装提示。

## 8. A7 — 回滚

```sh
pkill -f 'profile cb-e2e'      # 停一次性宿主（注意：命令行长，用 pid 更稳）
rm -rf ~/.dsh/profiles/cb-e2e  # 删一次性 profile
npm i -g cold-backup           # 装回全局 CLI
rm -f ~/.local/bin/cold-backup # 移除 shim（它指向的是一次性 profile，留着是隐患）
```

回滚后核对：

```
$ command -v cold-backup → /opt/homebrew/bin/cold-backup ; cold-backup --version → 1.0.3
$ desktop profile 的插件版本 → 1.1.1（线上那份，全程未被触碰）
$ launchctl print gui/501/com.haotianlu.dev-backup → 仍是卸载状态（本机已无 launchd 冷备任务）
$ lsof -iTCP:19998 → 端口已释放
```

## 9. 本次踩到、值得记住的三个坑

1. **`link:` 安装不装依赖** —— 用本地目录装（开发形态）时，`cold-backup` 不会进 profile，
   解析会退到仓库自己的 `node_modules`（能跑，但不是真实安装路径）。验收必须用 tarball / npm。
2. **PATH 上「存在但失败」的引擎 = `status-json-failed`**，不是 `engine-missing`。
   这是有意的：脚本退出 127 与「根本没有引擎」需要不同的修法，插件的既有原则就是
   「配了但用不了」绝不与「没配」混同。
3. **profile 的 `cordis.patch.yml` 若以 `[]` 结尾，直接 `>>` 追加条目会写出非法 YAML**
   （顶层数组后面又跟映射），补丁被整份忽略、且不报错。造配置时先把 `[]` 去掉。
