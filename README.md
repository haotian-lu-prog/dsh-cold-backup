[English](https://github.com/haotian-lu-prog/dsh-cold-backup/blob/main/README.en.md) | 简体中文

# dsh-cold-backup

[![npm 版本](https://img.shields.io/npm/v/dsh-cold-backup)](https://www.npmjs.com/package/dsh-cold-backup)
[![许可证](https://img.shields.io/npm/l/dsh-cold-backup)](LICENSE)
[![Node](https://img.shields.io/node/v/dsh-cold-backup)](package.json)

`dsh-cold-backup` 是一个纯第三方 DeepSeek Harness 插件：在 Harness 的 Web UI 里加一页「备份」，
回答一个问题——**我的定时备份到底跑了没有、最近一次成功是什么时候**。

它读的是「冷备约定」留下的三样东西，任何满足下面任一条的备份方案都能接入：

| 来源 | 含义 | 怎么读 |
|---|---|---|
| 成功时间戳文件 | 最近一次**成功**的时间 | 文件内容为 epoch 秒；不是纯数字就退回用文件 mtime |
| 失败日志 | 最近一次**出问题**的记录 | 取最后一行（约定会追加，所以最后一行最新） |
| launchd 任务 | 定时任务是否加载、上次退出码 | `launchctl print gui/<uid>/<label>` |
| 状态命令（可选） | 任意自检命令 | 退出码 0 视为正常，输出会显示在面板里 |
| JSON 状态命令（可选） | 结构化状态文档 | 跑一条命令（如 `cold-backup --status --json`），读它的 `cold-backup.status/1` JSON；**解析成功时以它为准**，并显示逐目标明细 |

判定规则只有一条值得记住：**只要失败记录没有被后来的成功「盖过」，就报有问题**。
用的是 `>=` 而不是 `>`——因为一次运行可能在同一秒里既写下成功时间戳、又留下失败记录，
用 `>` 会把这种情况静默藏掉（见 `docs/decisions.md`）。

## 功能

- **一眼看全的新鲜度** —— 面板顶部是状态点＋结论：正常 / 需要留意 / 有问题 / 尚未配置。
- **说清「为什么红」** —— 不是只给一个颜色，而是列出具体原因（过期 N 小时、状态文件不存在、
  launchd 未加载、退出码非 0、失败未被盖过……），中英双语。
- **自动刷新** —— 面板打开期间按 `refreshSeconds` 轮询 Host 半侧的路由，另有「立即刷新」。
- **三处联动的一致性** —— 包名、`cordis.patch.yml` 的 id、Host 的 `ENTRY_ID`、Client 的模块 id
  由测试强制对齐；这四者不一致时 Client 半侧会**静默不加载**，是同类插件的常见事故。
- **自带引擎（v2.0）** —— 本包把 `cold-backup` 声明为自己的依赖：**装插件就带引擎**，
  不必再单独 `npm i -g cold-backup`。状态页默认用它跑 `cold-backup --status --json`，
  并在面板上标明这次判定来自哪个引擎（自带依赖 / PATH / 你在设置里配的命令）。
  解析不到引擎时，退回下面那些通用来源，并明确说出「找不到引擎」，不假装正常。
  想让它**完全被动**（不解析、不起任何进程）：把 `bundledEngine` 关掉。
- **Host 半侧只用 node 内置模块** —— 唯一与 Harness 无关的 npm 依赖是
  `@deepseek-ai/schemastery`（只用来声明 Config）与引擎包 `cold-backup`（bash 脚本，不进 JS 运行时）。

## 要求

- Node.js `^22.19` 或 `>=24`
- DeepSeek Harness **`0.2.0-rc.2`**（本版本已实测；见 `docs/evidence/`）
- `launchd` 那一项仅 macOS 可用，其他来源跨平台
- 自带引擎是 bash 脚本：**macOS 3.2+ / Linux**。Windows 上引擎不会被装上（包声明了 `os`），
  面板会显示 `engine-missing`，其余通用来源照常工作

## 安装

装进一个自带 Web 界面的 profile。包本身不含任何指向 Harness 检出目录的路径依赖，
`dsh.bundle` 里的 patch 会自动把 Host 与 Client 两行插件接进去：

```sh
dsh --profile web-backup --from-default-profile web --dump-config
dsh plugin --profile web-backup add dsh-cold-backup
dsh --profile web-backup
```

装本地构建的 tarball 也行：

```sh
npm pack
dsh plugin --profile web-backup add ./dsh-cold-backup-<版本>.tgz
```

**引擎跟着一起来**：`cold-backup` 是本包的依赖，上面任何一条命令都会把它装进同一个 profile，
不需要额外的全局安装。

**想让 git 钩子 / cron / 别的工具也能直接调用引擎**（它们不经过插件，只认 PATH 上的
`cold-backup`），装一个稳定入口即可 —— 它**运行时**解析路径，所以升级依赖不会留下悬空链接：

```sh
mkdir -p ~/.local/bin && cat > ~/.local/bin/cold-backup <<'SH'
#!/bin/sh
for p in "$HOME"/.dsh/profiles/*/node_modules/cold-backup/bin/cold-backup; do
  [ -f "$p" ] && exec /bin/bash "$p" "$@"
done
for p in /opt/homebrew/bin/cold-backup /usr/local/bin/cold-backup; do
  [ -x "$p" ] && exec "$p" "$@"
done
printf 'cold-backup: 找不到引擎（装 dsh-cold-backup 插件，或 npm i -g cold-backup）\n' >&2
exit 127
SH
chmod +x ~/.local/bin/cold-backup
```

不想要它就直接删掉：行为回到「只认 PATH 上的全局安装」。

## 配置

在 **设置 → 插件 → dsh-cold-backup** 里改，全部字段都标了 `volatile()`，改完立即生效、不用重启：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `freshnessFile` | `~/Library/Logs/cold-backup/last-ok` | 最近成功时间戳文件 |
| `failureFile` | `~/Library/Logs/cold-backup/last-failure` | 失败记录（留空关闭） |
| `launchdLabel` | 空 | 要检查的 LaunchAgent label（留空关闭） |
| `statusCommand` | 空 | 可选自检命令，退出码 0 视为正常 |
| `statusJsonCommand` | 空 | 可选：打印 `cold-backup.status/1` JSON 的命令（例如 `cold-backup --status --json`）。解析成功时以它的判定为准，并显示逐目标明细。留空时自动改用自带引擎（优先级最高；这是**操作者配置**，动作层绝不复用它） |
| `bundledEngine` | `true` | 是否解析并使用本包依赖的引擎（回退 PATH）。关掉后插件完全被动：只读文件 / launchd 来源，不解析、不起任何进程 |
| `staleAfterHours` | `36` | 超过这么多小时没成功就报「需要留意」 |
| `refreshSeconds` | `30` | 面板轮询间隔 |

默认值直接对应**冷备约定**（`last-ok` 存 epoch 秒、`last-failure` 追加记录）——
也正是配套备份引擎 [`cold-backup`](https://www.npmjs.com/package/cold-backup) 在 macOS 上的默认位置，
所以「用 cold-backup + 装本插件」这条路**一个字段都不用改**。
换成别的备份方案时，只要把路径指过去即可，不需要这个约定本身。

举例：如果你的备份是 launchd 任务 `com.example.nightly-backup`、成功时间写在 `~/.backup/last-ok`，
就把 `launchdLabel` 填 `com.example.nightly-backup`、`freshnessFile` 填 `~/.backup/last-ok`。

## 它是怎么工作的

```
Host 半侧 (index.js)                      Client 半侧 (client.js)
  ├─ 读状态文件 / launchctl / 状态命令       ├─ 往 settings.section 注册一页「备份」
  ├─ evaluateStatus() 归一成 ok/warn/       ├─ 按 refreshSeconds 轮询 Host 的路由
  │  bad/unknown + 机器可读的 reasons        └─ 中英双语，列出每条 reason
  └─ 在 /dsh-cold-backup/status 上出 JSON
```

健康判定与解析全是纯函数，`node --test` 覆盖 28 项，不需要真实 Harness 即可跑：

```sh
npm test
```

## JSON 契约（`cold-backup.status/1`）

`statusJsonCommand`（留空时用自带引擎）读的是一份**跨工具共用**的判定：任何别的消费方读的也是同一份，
所以两处显示不可能各说各话。

| 字段 | 含义 |
|---|---|
| `schema` | `cold-backup.status/` 前缀；不匹配的文档一律不当成自己的 |
| `verdict` | `ok` \| `bad`（与那条命令的退出码一致） |
| `reasons[]` | `{code, target, message}`；`code` 是机器可读的英文标识，`message` 由脚本给出（保持中文 —— 脚本是与 launchd、文档、自测共用的事实源） |
| `targets[]` | 每个仓库/快照/配置一条：`state`（`ok`/`behind`/`missing`/`skipped`）、`upload`、`at`、`bytes`、`sha256`、`dirty`、`message` |
| `counts` / `orphans` / `lastOk` / `lastFailure` | 汇总计数、云盘残留、成功与失败信号 |

配置了它之后，**判定权在脚本**：本插件不再自己重算规则（历史上两边各写一份，面板用 `>`、插件用 `>=`，
已经漂移过一次）。没配、或输出不是合法文档时，回落到上面三种通用来源；「配了但用不了」会明确报成问题，
**不会静默回落**。

## 与冷备方案（`cold-backup`）的关系

本插件是**备份方案的 UI 前端**，不替代备份本身。冷备方案指的是：一个定时任务把
「最近成功时间」写进一个文件、把失败追加进一个日志，需要时再配一个 launchd 任务兜底。
插件只读这些产物，不写、不触发、不删除任何东西——所以它可以安全地常开。

**配套的备份引擎是 [`cold-backup`](https://github.com/haotian-lu-prog/cold-backup)**
（无依赖的 bash CLI，macOS / Linux）。从 v2.0 起它是**本包的依赖**，装插件即带引擎；
在设置里留空的 `statusJsonCommand` 会被自动替成 `<引擎> --status --json`：

```sh
cold-backup --init        # 生成配置，填 ROOT 与 DEST（一次性）
cold-backup --status      # 手动看一眼；插件面板显示的是同一份判定
```

优先级是**你配的命令 > 自带依赖 > PATH**；面板上的「引擎」一行会告诉你实际用的是哪一个。
另外两条路仍然完全可用：

- `cold-backup` **也可以只装全局**（`npm i -g cold-backup`）——那时引擎来自 PATH，行为不变；
- 它**不是必需的**：任何写出 `last-ok` / `last-failure`、或能输出 `cold-backup.status/1` 文档的
  备份方案都能接这个面板。反过来，`cold-backup` 也不依赖本插件——它自带 `--status`，
  本插件只是把同一份判定搬进了 Harness 的 UI。

> **关于 `statusCommand` / `statusJsonCommand`**：它们是**操作者配置的 shell 命令**，
> 属于你自己的机器、你自己的选择。插件的动作能力（v2.0 第二步）**绝不会复用**它们，
> 也不会由任何请求内容构造命令 —— 见 `docs/decisions.md` 的安全模型。

## 许可证

MIT，见 [LICENSE](LICENSE)。
