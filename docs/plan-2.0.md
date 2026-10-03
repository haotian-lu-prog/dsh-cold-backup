# plan-2.0 — 第 1 步：把引擎并入插件（实施与验收）

> 决策依据见 [`decisions.md`](decisions.md) 的 **2026-10-03「v2.0 定案」**（动作边界 / 安全模型 /
> 进度契约）。本文件只写**第 1 步**怎么落地、怎么算通过、怎么回到今天的状态。
>
> **状态：已实现 + 已真机验收（2026-10-03）。** 证据见
> [`evidence/e2e-v2-step1.md`](evidence/e2e-v2-step1.md)（A1–A7 逐条，含原始输出）。
> 版本号仍是 `1.1.1`，**未发布** —— 发版才提到 `1.2.0`（第 2 步留给 `2.0.0`）。
> 实施时相对本计划有三处调整，记在 §7。

## 0. 目标与非目标

**目标（一句话）**：装 `dsh-cold-backup` 一个包，就同时得到「状态页」与「引擎」——
不再需要 `npm i -g cold-backup`。

- ✅ 引擎作为**本包的 npm 依赖**（单一事实源：引擎仍在它自己的仓库 / CI / 发版流程里）；
- ✅ 状态页默认用解析到的引擎跑 `--status --json`，并在返回体里**说清用的是哪一个**；
- ✅ 提供一个**稳定入口**（`~/.local/bin/cold-backup`），让 git 钩子、cron、其他工具不依赖全局安装；
- ✅ 保持**只读**：不新增动作、不改路由动词、不引入 Remote。

**非目标（留给第 2 步）**：动作（POST 路由 + 信任判据）、T3 开关与二次确认、进度条、
README / 市场条目的承诺改写、major 版本号。第 1 步**不动** `index.js` 的路由形状。

## 1. 前置依赖

| 依赖 | 说明 | 阻塞第 1 步？ |
|---|---|---|
| 引擎发一版 ≥ 含 `51e06cc`（`--init` 模板的 `FDA_APP` 改通用写法） | 只是模板文案，不影响行为 | 否 |
| 引擎发一版 ≥ 含 `97d5ab2`（仅大小写改名的残留误报修复） | **第 2 步的硬门槛**：T3 的 `--prune-orphans --apply` 不能跑在带那个 bug 的版本上；第 1 步只读，不受影响 | 第 1 步：否；第 2 步：**是** |

依赖写 `"cold-backup": "^1.0.3"`，并在 README 注明「第 2 步要求 ≥ 修复版」。

## 2. 改动清单（文件级）

### 2.1 `package.json`
- 新增 `dependencies: { "cold-backup": "^1.0.3" }`（本包**首个**运行时依赖）；
- `files` 不变（引擎**不进**本包 tarball，靠依赖装进来）；
- `engines` / peer 范围不动。

### 2.2 `engine.js`（新文件，纯函数 + 可注入依赖）
```js
// 解析引擎路径：依赖 → PATH → null。绝不读请求体、绝不联网、绝不写盘。
resolveEngine({ require, env, platform }) -> {
  path: string | null,
  source: 'dependency' | 'path' | null,
  reason: 'missing-dependency' | 'missing-binary' | 'unsupported-platform' | null,
}
```
- 首选 `require.resolve('cold-backup/package.json')` → `dirname + '/bin/cold-backup'`；
  引擎包声明了 `bin`、且**没有** `exports` 字段，深路径解析可行（已核对 npm 元数据）；
- 回退：`PATH` 上的 `cold-backup`（保留「只有全局 CLI」的现有用法）；
- 校验：路径存在且是普通文件（**不要求执行位** —— 调用一律走 `/bin/bash <path>`，
  同时规避 shebang / 权限 / Windows 的差异）；
- `os: ["darwin","linux"]` 不匹配时给出 `unsupported-platform`，**不假装成功**。

### 2.3 `index.js`
- 新增配置字段 `bundledEngine: boolean = true`（`.volatile()`，描述里写明「关掉后回到今天的行为」）；
- 当 `statusJsonCommand` 为空**且** `bundledEngine` 为真时，默认命令 = `<engine> --status --json`
  （调用形态：`/bin/bash` + argv 数组，**不经 shell**）；`statusJsonCommand` 仍是操作者覆盖项，
  优先级最高（第 2 步的 README 要写明「动作路由绝不复用它」）；
- 返回体新增字段：`engineSource: 'dependency' | 'path' | 'config' | null`、`engineVersion`（取自
  `--version`，失败则为 `null`）、`enginePath`（**只给路径，不给请求体任何输入**）；
- 引擎缺失 / 不可用时：保留现有的文件来源（`freshnessFile` / `failureFile`）作为回退，
  并在 `reasons` 里加 `engine-missing`（新增 reason code = 加法，不破坏现有消费方）；
- **不新增任何路由**，现有路由**仍是 GET/HEAD**。

### 2.4 稳定入口 `~/.local/bin/cold-backup`（shim）
**不写 symlink**（pnpm 升级后 store 路径会变 → 悬空链接）。用**运行时解析**的脚本：
```sh
#!/bin/sh
# 由 dsh-cold-backup 的用户文档提供；解析顺序：profile 依赖 → PATH
for p in "$HOME"/.dsh/profiles/*/node_modules/cold-backup/bin/cold-backup; do
  [ -f "$p" ] && exec /bin/bash "$p" "$@"
done
for p in /opt/homebrew/bin/cold-backup /usr/local/bin/cold-backup; do
  [ -x "$p" ] && exec "$p" "$@"
done
printf 'cold-backup: 找不到引擎（装 dsh-cold-backup 插件，或 npm i -g cold-backup）\n' >&2
exit 127
```
- **不用 `postinstall`**：DSH 市场对带 install script 的包要额外批准（`approvedBuilds`），
  为一个 shim 引入那道流程不划算 → 用 README 里的一行命令安装；
- 脚本要幂等、可删；README 写清「删掉它就回到只依赖 PATH 的行为」。

### 2.5 `README.md` / `README.en.md`
- 新增一节「引擎从哪来」：装插件即带引擎（依赖）；只有全局 CLI 也能用；两者都有时**依赖优先**；
- 措辞修正：「零运行时依赖」→「Host 半侧只用 node 内置模块；引擎是独立包（bash，无 node 依赖）」；
- **只读承诺不变**（第 1 步没有任何动作）。

### 2.6 `test/plugin.test.js`
- 新增用例：① 依赖可解析 → `source: 'dependency'`；② 只有 PATH → `source: 'path'`；
  ③ 都没有 → `source: null` + `reason`，且 `collectStatus` **不抛异常**、仍给出文件来源的判定；
  ④ 请求体**不可能**影响引擎路径（把动作参数喂进解析函数，断言路径不变）；
  ⑤ `bundledEngine: false` → 回到「不调引擎」的行为。

## 3. 验收标准（可执行，逐条留证据）

| # | 验收 | 怎么验（命令 / 观察点） |
|---|---|---|
| A1 | 单测全绿 | `npm test`（`node --test`） |
| A2 | **卸掉全局 CLI 后仍有引擎判定** | `npm rm -g cold-backup` → `command -v cold-backup` 为空 → 打开状态页 / `curl -s http://127.0.0.1:<port>/dsh-cold-backup/status`，断言 `engine.document.schema === "cold-backup.status/1"` 且 `engineSource === "dependency"` |
| A3 | **卸掉全局 CLI 后提交仍触发冷备** | 装 shim → 在 `~/dev` 任一仓库 `git commit --allow-empty -m "e2e: plugin engine"` → `~/Library/Logs/cold-backup/backup.log` 出现新的 `trigger=post-commit` 行、`last-ok` 秒数变大 |
| A4 | 打包纯净（单一事实源） | `npm pack` → `tar -tzf dsh-cold-backup-*.tgz \| grep -c 'bin/cold-backup'` = **0** |
| A5 | 只读没变 | `curl -X POST .../dsh-cold-backup/status` → **405** |
| A6 | 引擎缺失时不假绿 | 临时把依赖移走（或 `bundledEngine:false` + 删全局 CLI）→ 页面显示「未配置 / 引擎缺失」+ 文件来源（若有），**不显示假正常** |
| A7 | 回滚可行 | 见 §4，恢复后 A2/A3 用全局 CLI 也照样通过 |

**证据落地**：A2/A3 的原始输出追加进 `docs/evidence/`（沿用现有 e2e 文档的写法），
不要只留在会话里。

**验收结果（2026-10-03）：A1–A7 全部通过** → [`evidence/e2e-v2-step1.md`](evidence/e2e-v2-step1.md)。

## 4. 回滚

1. `git revert <本次提交>`（第 1 步只有本包改动，引擎包与钩子都没动）；
2. `npm i -g cold-backup` 恢复全局 CLI（钩子的 `command -v cold-backup` 立刻能命中）；
3. 删 `~/.local/bin/cold-backup`（可选，留着也无害）；
4. 验证：状态页重新显示引擎判定 + 提交触发备份（= 今天的状态）。

**注意**：`git hooks` 与作者本机的工作区审计脚本**本轮不动** —— 它们现有的「PATH 优先」逻辑
在装了 shim 之后自然继续工作；等第 1 步真机验证过再考虑是否把 shim 写进工作区公约。

## 5. 风险

| 风险 | 应对 |
|---|---|
| profile 用 pnpm 安装，依赖不一定出现在预期路径 | A2/A3 就是这条的验证；解析失败要有 `engine-missing` 而不是静默回退 |
| 多 profile（desktop / web / headless）各自装一份，版本可能不同 | shim 取**第一个**命中的（文档写明）；`enginePath` 在页面上可见，便于发现装错 |
| 引擎是 bash，Windows 上不可用 | 依赖声明了 `os`，解析给出 `unsupported-platform` + 明确文案；不假装成功 |
| 「依赖优先」会让**已有**用户的行为变化（原本靠 `statusJsonCommand` 或文件来源） | `bundledEngine: false` 一键回到旧行为；README 把优先级写清（配置 > 依赖 > PATH） |
| 引擎发版节奏与插件解耦 | 依赖范围用 `^` 且 README 写明版本下限；第 2 步要求 ≥ 修复版（见 §1） |

## 6. 第 2 步（已定案，待排期）

动作层按 `decisions.md` 的 §一–§七 实施：POST + 信任判据 → T1/T2 默认开、T3 默认关 + 二次确认 →
进度契约（引擎侧 `COLD_BACKUP_PROGRESS_FILE` + 插件侧加权进度条）→ README / README.en / 市场条目
同版本改写 → 版本 2.0。**排期前置**：引擎先发含 `97d5ab2` 的版本。

## 7. 实施时的三处调整（2026-10-03）

1. **引擎每次采集时解析，而不是启动时解析一次**。代价是几次 `stat`（相对那条 60 秒的命令可忽略），
   好处是刚装好的引擎不用重启 Harness 就能生效。安全性质不变：解析只用本包的模块解析与 PATH，
   **永远不来自请求**。
2. **`engineVersion` 只在「依赖」来源下给出**（读它的 `package.json`）。PATH 来源不起 `--version`
   子进程 —— 这条路由每 30 秒被轮询一次，不值得为一个展示字段付一次 spawn。
3. **`engine-missing` 只在「没有别的来源能解释这块面板」时才出现**（状态文件缺失 + 没有 launchd +
   没有状态命令）。否则会给那些用别的备份方案、只是顺手装了插件的用户制造噪音 ——
   这条符合插件既有的「配了但用不了 ≠ 没配」原则。
