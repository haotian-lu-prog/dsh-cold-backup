# 决策记录

倒序追加。每条写清：背景、选项、结论、代价。三家工具都读这个文件，所以**不要只把决定留在会话里**。

> 读旧条目时注意：**2026-10-02 改名之前的条目里出现的 `dsh-dev-backup` / `dev-backup` /
> `dev-backup.status/1` / `~/Library/Logs/dev-backup` 等名字，是当时的真实名称**，不改写
> （它们是历史事实，改了就撒谎）。映射表见 `README.md` 与引擎仓库的
> `docs/compatibility.md` §7。

---

## 2026-10-02 — 改名：`dsh-dev-backup` → `dsh-cold-backup`

- **背景**：名字里的 `dev` 既不准确也不自解释 —— 本插件监视的是**冷备**（离线快照 + 可还原），
  不是实时同步；配套引擎 CLI 同步改名 `dev-backup` → `cold-backup`。作者拍板：名字里要出现「冷备」。
- **选项**：A 只改包名，路由 / 默认路径 / schema 前缀继续用旧名（改动最小，但从此两套名字并存 ——
  正是要避免的那种不一致）；B 全部改，干净断代；C 新名为主 + 兼容旧名（连 `dev-backup.status/` 也认）。
- **结论**：**B**。两个包 2026-09-30 才发布，已知用户只有作者本人 —— 这个窗口不会一直在，
  此时断代最便宜；留下 C 那层兼容就要永久维护两套前缀。
  换名清单：包名 / `cordis.patch.yml` 的 `id` 与 `name` / `ENTRY_ID` / Client 模块 id
  （**四者同名**这条硬约束不变，测试照旧交叉断言）、路由 `/dsh-cold-backup/status`、
  默认路径 `~/Library/Logs/cold-backup/{last-ok,last-failure}`、schema 前缀 `cold-backup.status/`、
  locale 命名空间 `settings.dshColdBackup`、组件名 `ColdBackupSection`。
- **代价 / 后续**：
  ① **npm 不支持改包名** —— 旧包 `dsh-dev-backup` 只能 deprecate（附指向新名的说明）；
     `npm i dsh-dev-backup` 仍能装到旧版本。
  ② 市场条目（PR #6322）的文件名由仓库 URL 推导（`<owner>__<repo>.yml`），GitHub 仓库改名后
     条目也必须跟着改名，否则市场脚本的 slug 对不上、CI 会红。
  ③ `docs/evidence/e2e-0.2.0-rc.2.md` 是**改名前**那次真机运行的记录：原样保留（改了就是伪造证据），
     只在文件头加一段改名说明。
  ④ 1.1.1 的「真机 Harness E2E」本来就还没做（见 `HANDOFF.md` 的「下一步」），所以这次改名
     **没有**新的端到端证据 —— 不能拿 1.0.0 那份记录冒充。

---

## 2026-10-02 — 上游联动：示例指向公开 CLI `dev-backup`，但**不做 PATH 自动探测**

- **背景**：冷备引擎已经抽成公开的 [`dev-backup`](https://www.npmjs.com/package/dev-backup)
  （npm + GitHub，接口与产物契约不变）。而本包是公开包，README 与配置项示例里却写着一个**只有作者
  机器上存在**的路径 `~/dev/_shared/bin/backup-dev.sh` —— 对陌生人是死链，对作者也只是众多形态之一。
- **选项**：A 示例改成 `dev-backup --status --json`（公开 CLI 的默认安装形态）；
  B 再加一层「PATH 里探测到 `dev-backup` 就自动用它」的推断；C 什么都不改。
- **结论**：**A**，**不做 B**。B 看起来贴心，但与 2026-09-30 那条「不做扫描推断」的决定冲突：
  猜错会给出一块**误导性的绿色**，而备份面板最不能做的就是骗人。示例是给人看的、配置是显式的。
- **顺带对齐**：`freshnessFile` / `failureFile` 的默认值（`~/Library/Logs/dev-backup/{last-ok,last-failure}`）
  **正好就是 `dev-backup` 在 macOS 上的默认日志目录** —— 也就是说「装 dev-backup + 装本插件」
  这条路一个字段都不用改。这条以前是「作者的约定」，现在是「公开引擎的默认」，README 里改写清楚。
- **代价 / 后续**：作者的机器仍跑私有脚本，所以本机要把 `statusJsonCommand` 填成
  `~/dev/_shared/bin/backup-dev.sh --status --json`（插件配置项，不是代码）。两处 UI 文案
  （`client.js` 的 `detailIntro`）改成不点名具体脚本的说法，免得对任何一方撒谎。

## 2026-10-02 — 新增 `dev-backup.status/1` 结构化源：判定权交给脚本

- **背景**：面板（macOS app）与本插件看的是同一批产物，但**判定规则各写了一份**：插件用 `>=`、
  面板用 `>`，于是「同一次运行既写 `last-ok` 又留 `last-failure`」在面板上被判成正常。
  复刻 runner 不成立（见下一条），但「两个界面各说各话」是真问题。
- **选项**：A 让插件把面板的那套规则也实现一遍（第三份）；B 让脚本输出结构化文档，两边都只消费它；
  C 只做插件、面板不动。
- **结论**：**B**。给 `backup-dev.sh --status` 加 `--json`（契约 `dev-backup.status/1`），
  脚本里 `status_collect` **只判定一次**，人读文本与 JSON 是它的两个出口；本插件新增可选字段
  `statusJsonCommand` 消费它，macOS 面板同样消费它。
  - 判定权：文档解析成功时**以它为准**（`verdict` 驱动 level，`reasons` 原样透出并加 `engine:` 前缀
    与插件自己的词汇表分开），插件的通用来源退化成展示行。
  - 边界：「配了但用不了」与「没配」必须分得开 —— 前者判 `bad` 并给 `status-json-failed`，
    后者才走 `unknown`；非零退出**不丢 stdout**（`--status --json` 正是「合法文档 + 退出码 1」）。
  - 安全：只读性质不变（还是不起备份、不写云盘）；`schema` 前缀不匹配的文档一律不当成自己的。
- **代价 / 后续**：面板的 `--status` 动作改成 `--status --json`，并新增无界面入口
  `--render-status-json`（GUI 点不动，但渲染逻辑要可测）。本机**没有 Swift 工具链**，
  面板侧只落到源码、编译不了 —— 见 `_shared/HANDOFF.md` 未决问题。

## 2026-10-02 — 不复刻 `dev-backup-runner`：本插件保持「只读监视器」

- **背景**：用户要求评估「把 `~/Applications/dev-backup-runner.app`（自建冷备面板）的功能复刻进本插件」。
  那个软件实际是两件事：（a）AppKit 面板 —— 4 条日常命令的按钮 + 实时输出 + 退出码徽标 + 中英双语；
  （b）**绑在「bundle id + 签名证书」上的 FDA 授权主体**，供 launchd 每日任务与 `--daily` 无界面模式使用。
  真正的备份逻辑在 `_shared/bin/backup-dev.sh`（848 行），触发源是 git 钩子（post-commit / post-rewrite）
  与 launchd（12:00 + 登录）；本插件与它们没有调用关系。
- **选项**：A 整体复刻（引擎 + 触发 + 权限引导）；B 只取呈现层；C 维持现状，动作仍去面板。
- **结论**：**只取 B 的只读部分；A 不做**。本轮按用户要求**只记录判断，未改任何代码**。
  - **可以做（按需，另开一轮）**：读脚本的结构化输出 —— 但要先给 `backup-dev.sh --status` 加 `--json`，
    本插件只消费该契约（而不是在 JS 里重算规则）；可选「触发**已有** launchd 任务」按钮
    （`launchctl kickstart`，label 默认留空、显式 opt-in；现在是 GET 路由，加副作用动作前要先解决这一点）。
  - **不做**：备份写路径、`--verify --fix`、`--prune-orphans --apply`、launchd 安装/卸载、FDA 执行部分。
  - **理由**：① 插件只在 DSH 进程活着时存在，而备份的触发源不经过 DSH，搬进来是可靠性倒退；
    ② FDA 授给的是那个 app（`com.haotianlu.dev-backup.runner` + 证书叶指纹），插件不是可执行主体、
    无法作为 launchd 任务的被授权方；且「从插件写云盘」本机**未验证**（读是验证过的）；
    ③ 本包已上 npm 并向 dsh market 投稿（PR #6322），README 明确承诺「只读…可以安全地常开」，
    市场评审会拿描述核对代码 —— 复刻执行层等于换一个产品，还要把本机私有约定塞进公共包；
    ④ 引擎被 95 项自测 + `audit.sh` + 两个 git 钩子钉死，在 JS 里再写一份必然漂移（**已经漂移了**，见下）；
    ⑤ 插件是进程内 JS、不经工具层沙箱，出口却是无鉴权的本地 HTTP 路由；把删除类动作挂上去
    就是本机可 GET 触发的破坏面。
- **代价 / 后续**：两个界面并存（面板看实时输出、DSH 看状态）。若确实嫌割裂，正确方向是
  「一份 JSON 契约、两个 UI」，不是把引擎搬家。
- **顺带发现（真 bug，未修）**：同一规则目前有**两份**实现且已经漂移 —— 本插件的判定见下一条
  2026-09-30「用 `>=` 而不是 `>`」，而面板 `_shared/app/App.swift` 的 `computeHealth` 仍是严格 `>`。
  两份里插件的写法才是安全的那个（`>` 会漏掉「同一次运行既写成功又留失败」）。

## 2026-09-30 — 插件形态：settings.section 一页 + Host 路由供数

- **背景**：要在 DSH Web UI 里显示「备份新鲜度」。可用插槽很多（`shell.overlay`、
  `sidebar.panellist`、`conversation.input.dock`、`settings.section`…），Host→Client 的取数方式也要先定。
- **选项**：A. `settings.section` 一页；B. `shell.overlay` 常驻徽标；C. `sidebar.panellist` ＋ `main` keyed 面板。
- **结论**：先做 A，取数走 Host 的 `ctx.webServer.register({ kind: 'exact', path })` 出一条
  `/dsh-dev-backup/status`，Client 同源 `fetch()` 轮询。
  - A 是参考实现（同作者的 `dsh-notifications`）已经在 `0.2.0-rc.1` 上端到端跑通的插槽，风险最低；
    `main` 是 keyed 插槽（`already taken: conversation`），`sidebar.panellist` 与面板的联动没有现成范例。
  - `webServer` 是 shipped 服务，`register` 返回 disposer，正好放进 `ctx.effect` 的清理里。
- **代价 / 后续**：状态藏在「设置」里，不是常驻可见。要做常驻徽标得另开一轮用 `shell.overlay` 验证。
  自建 HTTP 路由要求路径唯一（重复注册会 throw），故用了带包名的前缀。

## 2026-09-30 — 「失败是否被盖过」用 `>=` 而不是 `>`

- **背景**：实测拿到真实数据时发现 `last-ok` 与 `last-failure` 的 epoch **完全相同**
  （同一次 `--daily` 运行既写了成功时间戳、又留了「有目标被跳过（疑似密钥或读不到）」的记录）。
  最初写成「失败比成功**更新**才算问题」（严格 `>`），于是这种情况被判成 `ok` —— 恰好把最该报的
  信号静默藏掉。
- **选项**：A. 严格 `>`；B. `>=`；C. 只要 `last-failure` 存在就报。
- **结论**：B。「失败没有被后来的成功盖过」。C 太吵（历史失败会一直挂着，成功也盖不掉）。
  同时把该 reason 的措辞从「失败发生在成功之后」改成「失败没有被后来的成功盖过」。
- **代价 / 后续**：理论上「同一秒内先失败后成功」的极端情形会误报一次；相对漏报真实问题，
  这个方向更安全。README 把这条规则单独写出来，避免用户困惑。

## 2026-09-30 — 配置字段必须 `volatile()`，且读取要兼容两种形态

- **背景**：第一版 `Config` 没加 `.volatile()`，`.get()` 直接抛错，
  `/dsh-dev-backup/status` 返回 `500 collection-failed`，而日志里连原因都看不到。
- **选项**：A. 只加 `.volatile()`；B. 只做兼容读取；C. 两者都做。
- **结论**：C。
  1. 所有字段加 `.volatile()`（与参考实现一致）—— 顺带得到「改配置立即生效、不重挂插件」。
  2. 读取一律走 `readField()`：有 `.get()` 就调用，否则当纯值用，Loader 给不给引用都不会崩。
  3. 路由 catch 里把 `detail` 一并放进 JSON —— 只有 `collection-failed` 四个字在浏览器里没法排查。
- **代价 / 后续**：`readField` 多一层间接；换来对 Loader 形态变化的鲁棒性。无回看必要。

## 2026-09-30 — 默认值贴合「冷备约定」，但 launchd 默认关闭

- **背景**：插件要给陌生人用，默认值又想让作者开箱即用。
- **选项**：A. 默认全空 + 引导；B. 默认指向冷备约定；C. 启动时扫描推断。
- **结论**：B，但只对文件类来源；`launchdLabel` 与 `statusCommand` 默认空。
  - launchd label 留空，是因为作者的 label 是 `com.haotianlu.dev-backup`，写进公共包的默认值
    对别人毫无意义且显得可疑。
  - 未配置或路径不存在时，面板明确显示「尚未配置」/「状态文件不存在」，**不会**假装正常。
  - 不做 C（扫描推断）：猜错会给出误导性的绿色，比留空更糟。
- **代价 / 后续**：陌生人首次安装要改一次路径；README 用一张表写清每个字段。若反馈说门槛高，
  再考虑加一个「检测到的常见位置」提示（仍然由用户点确认）。

## 2026-09-30 — 不设 `os: ["darwin"]`

- **背景**：`launchd` 是 macOS 专有，参考实现直接声明 `os: ["darwin"]` 把包限制在 macOS。
- **选项**：A. 跟随参考实现限制 macOS；B. 不限制，运行时降级。
- **结论**：B。非 darwin 平台上把 launchd 来源标成 `unsupported` 并跳过；
  文件时间戳与状态命令两个来源本身跨平台。
- **代价 / 后续**：在 Linux 上装出来只会用到部分能力，由面板文案说明，而不是靠安装期拦截。

## 2026-09-30 — 包名与四处标识的一致性由测试强制

- **背景**：Harness 按**包名**索引客户端模块表。包名、`cordis.patch.yml` 的 `id`/`name`、
  Host 的 `ENTRY_ID`、Client 的 `__ModuleLoader__.load({ id })` 四者不一致时，Client 半侧会
  **静默不加载** —— 不报错，只是页面永远不出现（同生态里已经出过这类事故）。
- **选项**：A. 只写在文档里；B. 写一条测试做交叉断言。
- **结论**：B。测试同时读 `package.json`、`cordis.patch.yml`、`client.js` 三者比对。
- **代价 / 后续**：无；纯防回归。
