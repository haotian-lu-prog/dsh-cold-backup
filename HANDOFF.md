# HANDOFF

> 三家的接力棒：DSH / Codex / Claude Code 都读这个文件。**开工先读，收工必更新并提交。**

## 当前写者

- 工具：（空 —— 2026-10-03 DSH 会话已收工：**v2.0 第 2 步（动作层）已实现并真机验收通过**）
- 分支：main
- 开始时间：—
- 本轮：**v2.0 第 2 步 = 动作层**（设计与安全模型见 `docs/decisions.md` 的 2026-10-03 条目）：
  ① `trust.js`（新）—— 动作路由的信任判据，语义与 `dsh-archived/lib/host/trust.js` 对齐；
  ② `actions.js`（新）—— 固定 argv 的动作表、单飞作业、进度解析与加权、取消、清理；
  ③ `index.js` —— 读路由不动，新增 `POST /action`、`POST /cancel`、`GET /job`；
  新配置 `allowActions`（默认开）/ `allowDestructive`（默认关）；
  ④ 客户端 —— 五个动作按钮（T3 要点两次）、进度条（引擎没写进度时画流动条）、取消、
     运行期间轮询从 `refreshSeconds` 提到 2 秒；
  ⑤ README / README.en 改写承诺（**读永远只读；写可选**）+ 安全模型小节；
     市场条目加了「2.0 必须同版本重投稿」的提醒；版本 → **2.0.0**；测试 37 → **48 项**；
  ⑥ 验收 **全部通过**，证据 `docs/evidence/e2e-v2-step2.md`：跨站 403 / 无标记头 403 /
  未知动作 400 / T3 默认 403、打开后 202 / 单飞 409 / 取消后进程 3 秒内退出且**锁已释放** /
  `--daily` 真机进度 `1% → 49% → 83% → 87% → 100%`（备份 17/17、校验 107/107）。
- 分支：main
- 开始时间：—
- 本轮：**v2.0 第 1 步 = 引擎并入插件**（同一天先落决策文档，再实现 + 验收）。要点：
  ① `docs/decisions.md` 新增 v2.0 定案（动作边界四条 / 安全模型 / 进度契约，含实测证据）；
  ② `docs/plan-2.0.md` 写清第 1 步的改动清单、验收 A1–A7、回滚与风险；
  ③ 实现：新增 `engine.js`（依赖 → PATH → 明确失败），`index.js` 加 `bundledEngine` 开关与
  `engineSource`/`engineVersion`/`enginePath`/`engineMissing`，`statusJsonCommand` 留空时自动用自带引擎；
  `package.json` 加 `dependencies: cold-backup ^1.0.3`；客户端多一行「引擎」；两个 README 同步
  （含 git 钩子要用的 shim 一行命令）；测试 28 → **37 项**（顺手把测试真正需要的
  `@deepseek-ai/schemastery` 补成 devDependency —— 它此前没写进 package.json，靠手工装，
  `npm install` 一跑就被当多余包清掉）；
  ④ 验收：**A1–A7 全部通过**，证据见 `docs/evidence/e2e-v2-step1.md`。关键两条 ——
  「一次安装 = 插件 + 引擎」（pnpm `+2 packages`）、「卸掉全局 CLI 后提交仍触发备份」
  （`last-ok` 14:05:58 → 14:19:02，全程只有 profile 里那份引擎）。
  验收用的是一次性 profile `cb-e2e` + 独立端口 19998，**没碰在用的 `desktop`**；完事已回滚
  （profile 删除、全局 CLI 装回、shim 移除、端口释放）。
- 上一轮：**改名** —— 插件 `dsh-dev-backup` → **`dsh-cold-backup`**，与引擎 CLI
  `dev-backup` → **`cold-backup`** 同步：包名、Cordis 入口 id、路由 `/dsh-cold-backup/status`、
  默认路径 `~/Library/Logs/cold-backup/*`、JSON 契约前缀 `cold-backup.status/` 全部换成新名，
  **不留旧名兼容**。旧 npm 包 deprecate、GitHub 仓库改名（旧 URL 自动重定向）、市场条目跟着换。
  本文件下文与 `docs/evidence/` 里的旧名是当时的真实名称，作为历史记录不回改。
- 上一轮：**上游联动** —— 冷备引擎已抽成公开 CLI
  [`dev-backup`](https://www.npmjs.com/package/dev-backup)（npm + GitHub，接口与产物契约不变），
  本包作为它的 UI 前端跟着对齐：① `statusJsonCommand` 的示例从**作者私有路径**改成
  `dev-backup --status --json`；② README（中/英）写清两者的关系，并点明「本插件的默认文件路径
  **就是** `dev-backup` 在 macOS 上的默认日志目录，所以那条路一个字段都不用改」；
  ③ 两处 UI 文案（`client.js` 的 `detailIntro`）不再点名具体脚本，对任何接入方案都不撒谎；
  ④ README 里的 tarball 名改成 `<版本>` 占位符，免得每次发版都留一处过期的示例。
  **不做 PATH 自动探测**（猜错会给出一块误导性的绿色）——理由见 `docs/decisions.md` 顶部。
- 开工前已核对：本地 main 与 `origin/main` 一致，无需 rebase。

> 一个仓库同一时刻只允许一个写者。下一位把上一行改成自己，并先读完下面的状态。

## 当前状态

**2026-10-02 追加（六）：改名 —— 插件 `dsh-dev-backup` → `dsh-cold-backup`（本轮，已本地验证）。**

- 目录 `~/dev/plugins/dsh-dev-backup` → `~/dev/plugins/dsh-cold-backup`。
- 换名清单：包名、`cordis.patch.yml` 的 `id`/`name`、`ENTRY_ID`、Client 模块 id
  （**四者同名**这条硬约束不变，测试照旧交叉断言）、路由 `/dsh-cold-backup/status`、
  默认路径 `~/Library/Logs/cold-backup/{last-ok,last-failure}`、schema 前缀 `cold-backup.status/`、
  locale 命名空间 `settings.dshColdBackup`、组件 `ColdBackupSection`、仓库 URL。
  版本号仍是 **1.1.1**（同一份代码换个名字，不是新功能）。
- 验证：`npm test` **28/28**；并对 13 个改动文件做了「纯词法替换」证明 —— 8 个文件逐字符等于
  「旧内容套上改名规则」，其余 5 个的额外改动都是刻意加的（证据文件开头的改名说明、
  `docs/market-submission.md` 的改名说明、`package.json` 关键词去重、本条 HANDOFF）。
- 配套改动：引擎 CLI `dev-backup` → `cold-backup`（同一批次，JSON 契约前缀同步成
  `cold-backup.status/1`）。
- `docs/evidence/e2e-0.2.0-rc.2.md` **原样保留**（改名前那次真机运行的真实记录，改了就是伪造证据），
  只在文件头加了改名说明。
- **真机 E2E 补齐**：新增证据文件第 8 节（隔离 `DSH_HOME` + 从 npm 装 `dsh-cold-backup@1.1.1`）——
  `# == dsh-cold-backup` 生效、`GET /dsh-cold-backup/status` 返回真实状态
  （`level=ok`，`freshness.path` = 本机 `~/Library/Logs/cold-backup/last-ok`，`ageHours≈0.009`）、
  Client 模块以包名注册、bundle 取回 **HTTP 200 / 21592 字节**（与仓库 `client.js` 逐字节相同）、
  启动日志无 error/warn。换句话说：**「私有脚本 → 日志目录 → 插件默认值 → 面板」四条腿
  现在叫的是同一套名字**。
- 发布面（同一天完成）：
  - GitHub 仓库改名 `dsh-dev-backup` → **`dsh-cold-backup`**（旧 URL 301 重定向，已实测）；
    Website 按公约回填成 <https://www.npmjs.com/package/dsh-cold-backup>。
  - npm 新包 **`dsh-cold-backup@1.1.1`** 已发布（本机 `npm publish`，**无 provenance** ——
    新包名在 npm 上没有 trusted publisher，CI 那条路得重新配一次，见「下一步」）。
  - 市场投稿换成 PR **#6410**（`data/plugins/haotian-lu-prog__dsh-cold-backup.yml`，+1 文件 / +6 行，
    以最新上游 `main` 为基）。**旧的 #6322 被 GitHub 自动关闭**：改名 fork 的 head 分支等于让
    该分支消失，PR 就会自动 close —— 已在 #6322 上留说明指向 #6410。
  - **旧包 `dsh-dev-backup` 已 deprecate**（2026-10-02 深夜补做）。第一次失败的原因是**包级**
    `mfa=publish`：npm 回 `403 Two-factor authentication is required to publish this package but an
    automation token was specified` —— 同一个 token 能 deprecate `dev-backup`、却动不了这个包，
    `npm access set mfa=automation` 也是同一个 403（这条路堵死）。
    走通的姿势：`npm login --auth-type=web`（浏览器过一次 passkey）＋ 在**伪终端**里跑
    `npm deprecate "dsh-dev-backup@*" "<消息>" --auth-type=web` —— 非 TTY 时 npm 会把
    `/auth/cli/<id>` 打码、也不会真的轮询，必须用 PTY 包一层（`script -q /dev/null` 或
    `pty.fork()` 的包装脚本）。
    **一个坑**：npm 最后报 `E422 Unprocessable Entity`，但改动**其实已经落库** ——
    `npm view dsh-dev-backup deprecated` 与装包时的 `npm warn deprecated …` 都能看到消息，
    三个版本（1.0.0 / 1.1.0 / 1.1.1）全带上了。**别被那个 E422 骗着重跑。**

**2026-10-02 追加（二）：插件已能消费 `dev-backup.status/1`（`statusJsonCommand`），
与 macOS 面板从此读同一份判定；只读性质不变。`npm test` 28/28。**

**2026-10-02 追加（三）：`v1.1.0` 的 Release 已建、CI（`publish.yml`）已跑但**在 npm 那步失败**：
它成功签了 provenance，然后 `PUT https://registry.npmjs.org/dsh-dev-backup` 返回 **E404**
（npm 对「无权限」一律回 404）。原因就是下面「下一步」里那件没做的事 —— trusted publishing 还没配。**
→ 配好后已解决，见（四）。

**2026-10-02 追加（四）：`dsh-dev-backup@1.1.0` 已发布**（`dist-tags.latest`，带 provenance）。
两个细节值得记：
1. **走的是「暂存 → 批准」**：trusted publisher 配好后 CI 那次 `npm publish` 把 1.1.0 放进 npm 的
   staging（该次 CI 因此 conclusion=**success**），随后在 npm 侧批准才真正落到 registry
   （`npm stage list dsh-dev-backup` 在批准后就空了）。**在批准前重跑 CI 会得到 `E409
   Cannot publish over previously staged version`** —— 那不是失败，是「还没批准」。
   想要**直接发布**、免掉这次批准，就在 npm 的 trusted publisher 配置里勾上 allow publish
   （现在给的是 allow stage publish）。
2. **「三方逐字节一致」不再自动成立**：CI 用的 npm 与本机 npm 版本不同，同源码打出的 tar
   字节不同（registry 20221 字节 / 本机 `npm pack` 19824 字节，**解包后内容完全相同**）。
   已把 Release asset 换成 **registry 那一份**（sha256 `03a06d8f…`），恢复「asset == 已发布产物」；
   本地那份 `.tgz` 也已对齐。要复现「三处字节一致」，得让本机 npm 与 CI 的版本相同。
   权威口径：registry 的 `dist.integrity` 与 provenance 的 subject sha512 一致（`48985eb8…` 开头）。

**2026-10-02 追加（五）：`v1.1.1`（上游联动）已发布 npm** —— `dist-tags.latest = 1.1.1`，带 provenance。
两个新事实：
1. **这次是直接发布，不再走 staging 批准**：CI 日志直接给 `+ dsh-dev-backup@1.1.1`
   （说明 trusted publisher 已从 allow stage publish 改成 allow publish，「下一步」里那个选择题有答案了）。
   唯一的等待是 registry 传播，实测约 **2 分钟**才 `npm view` 得到。
2. **「asset == 已发布产物」这条不变量继续成立**：Release asset 已换成 registry 那一份
   （sha256 `c7a46754a22eb677f0f6a7f978855d08a54048162ba317511073ef06e32a669d`，20950 字节）。
   本机 `npm pack` 的字节仍与 registry 不同（npm 版本不同），**解包后内容逐文件一致** —— 与 1.1.0 同一个现象。
   校验侧：registry `dist.shasum` = CI 日志里的 `c8d0de58b4b9bf8f0190af03ece5c9da6d6dbf42`；
   `npm audit signatures` 报「4 packages have verified registry signatures / 2 packages have verified attestations」。

**2026-10-02 追加：已评估并否决「把 `dev-backup-runner` 复刻进本插件」——结论是只取只读呈现层，
不搬引擎/调度/权限；理由与本轮实测证据见 `docs/decisions.md` 顶部。**

**四件事全部完成：插件已做完并真机验证、已发 npm、已公开发 GitHub、市场投稿 PR 已提交且 CI 通过。**
只剩维护者评审合并（不由我们控制）。

- 目标：把 dev-backup 做成 DSH 插件 → 上传 npm + GitHub → 申请加入 dsh market，
  让人能在 **DSH 0.2.0-rc.2** 的 UI 里看备份实时状态。
- 形态：第三方 bundle 插件，`settings.section` 一页「备份」。Host 半侧读
  成功时间戳文件 / 失败日志 / `launchctl` / 可选状态命令，归一成 `ok|warn|bad|unknown`
  ＋机器可读的 `reasons`，在 `/dsh-dev-backup/status` 上出 JSON；Client 半侧轮询并画面板（中英双语）。
- 本地验证：
  - `npm test` → **19/19 通过**（含 Client 半侧用 stub 的 `__ModuleLoader__` 真实加载、
    四者同名一致性、zh/en 字典键集一致）
  - **端到端通过（真实 DSH 0.2.0-rc.2）**：隔离 `DSH_HOME` + `--from-default-profile web`
    建 profile，`dsh plugin add <本地目录>` 装成 link，启动无 error/warn；证据见
    `docs/evidence/e2e-0.2.0-rc.2.md`：
    1. `--dump-config` 里出现 `# == dsh-dev-backup` / `- id: dsh-dev-backup`（patch 生效）
    2. `GET /dsh-dev-backup/status` 返回**真实状态**（当时 `level=bad`，原因是
       `failure-not-superseded`，把「有目标被跳过（疑似密钥或读不到）」这句从日志里捞了出来）
    3. Client 模块以**包名** `dsh-dev-backup/client.js` 出现在启动页模块表里，与官方客户端模块并列
    4. 该模块 URL 取回 **HTTP 200 / 14732 bytes**，内容就是本仓库的 `client.js`
- **GitHub 已发布**（2026-09-30）：
  - 仓库 <https://github.com/haotian-lu-prog/dsh-dev-backup>，**PUBLIC**，
    `createdAt = 2026-09-30T08:59:35Z`；topics：`backup` / `deepseek-harness` / `dsh` /
    `dsh-plugin` / `launchd`；匿名 `curl` 返回 HTTP 200（含 raw README）。
  - 首个提交 `881f2ba`（分支 `main`）。
  - Release `v1.0.0`：<https://github.com/haotian-lu-prog/dsh-dev-backup/releases/tag/v1.0.0>，
    附 asset `dsh-dev-backup-1.0.0.tgz`，**sha256 `cc73be40a059c92cd56b8415fb973ede886f9175b04a368b9fd9a4f4a3eda281`**。
  - 踩坑：首次 push 被 GitHub 以 *email privacy restrictions* 拒绝。原因是 `dev-new` 建仓后用的是
    全局提交身份（iCloud 邮箱）。已把**仓库本地**身份设为
    `49531320+haotian-lu-prog@users.noreply.github.com` 并 `--amend --reset-author` 重写提交。
    （`_shared` 的 HANDOFF 早记过同一条，新仓库仍会再踩一次——`dev-new` 可以考虑顺手写好本地身份。）
- **npm 已上架**（2026-09-30）：`dsh-dev-backup@1.0.0`，`dist-tags.latest = 1.0.0`。
  - **三方校验和逐字节一致**：registry 的 `dist.tarball` 下载 / GitHub Release asset `v1.0.0` /
    本地 `npm pack` —— sha256 均为
    `c18e8f58c5a9121dc3a39e5f36438991c6bdd0471b70ed4cf02422ba304db366`。
  - registry 上 `repository.url = git+https://github.com/haotian-lu-prog/dsh-dev-backup.git`
    （市场脚本 `probe-npm.mjs` 要求这一点，否则卡片会退化成"从源码构建"）。
  - **从 npm 装的端到端也验过**（全新隔离 `DSH_HOME`，既不是本地 link 也不是本地 tarball）：
    `dsh plugin add dsh-dev-backup` → patch 生效、路由 200、Client 模块以包名注册且 bundle 取回
    **HTTP 200 / 15369 bytes**、日志无 error/warn。见 `docs/evidence/e2e-0.2.0-rc.2.md` 第 7 节。
  - **发布过程踩的坑（值得记）**：账号 2FA 是 **passkey**，没有 6 位 OTP，所以 `npm publish`
    直接报 `EOTP`、`--auth-type=web` 也一样；最后是建了一个**开了 Bypass 2FA 的
    granular access token** 写进 `~/.npmrc` 才发出去。
  - ⚠️ 那个 granular token 是**为首次发布临时建的**。配好 trusted publishing 之后应**删掉它**
    （见「下一步」）。
  - 更早的失败形态留档：未登录时 `npm whoami` → `E401`，`npm publish` → **`E404` on PUT**
    （npm 用 404 表示"无权限创建该包名"，不泄露包名是否存在）。
- **dsh market 投稿已备好并干跑验证通过**（2026-09-30，未开 PR）：
  - 投稿形态：往 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/<owner>__<repo>.yml`
    **只加一个文件**。本仓库的条目：`data/plugins/haotian-lu-prog__dsh-dev-backup.yml`，
    分类 **`dev`**（市场的 "Development & Runtime"；`notify` 不合适——本插件不通知，只显示状态）。
  - **逐条对照了市场的 `contributing.md`**，两条原本不符、已改：
    1. 「官方 `@deepseek-ai/*` 包请用 peerDependencies 声明」——`schemastery` 原先在 `dependencies`。
       已改成 peerDependency，**并实测确认可用**：官方 web profile 里根本没有 schemastery
       （harness 自己内部解析官方包）；全新隔离 profile 装 tarball 时 pnpm 只装了 1 个包、
       没自动装 peer，插件照样启动、路由 200、日志无报错。本地 `npm install` / `npm ci`
       会自动装上非可选 peer，19/19 测试全过。同生态的 `dsh-plugin-proxy` 也是这么声明的。
    2. 「描述一行、以句号结尾、无营销词」——原描述是两行长句，已改短。
  - 干跑（浅克隆 + `npm ci` + 切分支 + 提交，再跑市场自己的脚本）：
    - `slugFor(url)` == 文件名 ✓；`readEntries()` 解析成功（含 `tarball` 字段），条目数 4392 → **4393** ✓
    - 仓库自带测试 `added-dates` / `capabilities` / `adopt-discussions` → **18/18 通过** ✓
    - **`scripts/check-submission.mjs`（带真 GITHUB_TOKEN）→ 唯一失败项就是年龄**：
      "repository is 0.0 days old (needs 1) — nothing to do: this check re-runs by itself and
      should clear in about 24h"。也就是说 `dsh.bundle` 清单、非归档、非 DSH 本身这几项**都已经过了**。
  - **条目带 `tarball:` 字段**，钉住 `v1.0.0` 的 Release asset：
    因为 npm 还没上架，市场就能给出一行预构建安装命令而不是"从源码构建"。
    钉 tag 而非 `latest/download/`——后者只在请求时解析 `latest`、文件名按字面取，
    资产名带版本号时会"当天有效、下次发版 404"。
  - 分支已推到 fork（不在 `/tmp`，不会丢）：
    `haotian-lu-prog/awesome-dsh-plugin` 分支 `add-dsh-dev-backup` @ `1ba2700`，diff **+1 文件 / +7 行**。
  - 年龄门槛：仓库建于 `2026-09-30T08:59:35Z` → **`2026-10-01T08:59:35Z` 之后**才能提 PR。
  - 详细对照表与执行步骤见 `docs/market-submission.md`。
- **CI 已补齐**（本轮新增）：`.github/workflows/conventions.yml`（与工作区模板逐字节一致）
  与 `.github/workflows/publish.yml`（trusted publishing 发布流水线）。
- **首次运行体验修正**（本轮）：冷备约定的默认路径在陌生机器上**本来就不存在**，
  于是新装的人一打开设置就看到红色「有问题 / 状态文件不存在」——读起来像"插件坏了"。
  现在 Host 半侧多返回一个 `explicitlyConfigured`（用户是否真的指过任何来源），
  面板只在「默认配置**且**默认文件确实缺失」时才显示「尚未配置」引导。
  - **健康判定刻意不变**（仍是 `bad`）——这个标志只驱动提示文案，有测试守着不让它软化信号。
  - 踩到的坑：第一版条件写成「`explicitlyConfigured === false` 就提示」，于是**本机这种
    "照着约定用、从没打开过设置"的人也会看到"尚未配置"**（他的配置同样是默认值）。
    补上 `freshness.missing === true` 后才两边都对。已加正反两个测试 + 真机路由验证。
- 关键取舍与实测踩坑：见 `docs/decisions.md`。

## 下一步

- [x] ~~**（v2.0 第 1 步）把引擎并入插件**~~ → **2026-10-03 已实现 + 真机验收通过**
      （A1–A7，证据 `docs/evidence/e2e-v2-step1.md`）。**未发布**：版本号仍是 `1.1.1`，
      发版时提到 **`1.2.0`**（第 2 步留给 `2.0.0`）。
      ⚠️ 两个只在本机验过的点，发版前值得再确认一次：① 从 **npm 装的正式包**（而不是本地 tarball）
      也带依赖；② 用户按 README 装 shim 后，git 钩子仍能找到引擎。
- [x] ~~（发布动作）第 1 步要不要单独发一版 `1.2.0`~~ → **用户 2026-10-03 决定：不发**。
      第 1 步**随第 2 步以 `2.0.0` 一起出**：期间 npm 上仍是 `1.1.1`，本机（装的是 npm 那份 +
      全局 CLI）不受影响。下面那两个复核点因此挪进 **2.0 的发版清单**。
- [x] ~~**（v2.0 第 2 步）动作层**~~ → **2026-10-03 已实现 + 真机验收通过**
      （证据 `docs/evidence/e2e-v2-step2.md`）。进度条那一组的验收用的是**工作区的引擎**
      （进度契约还没发布）。
- [ ] **（发 2.0 的前置，按顺序）**
      ① 引擎先发一版：含 `97d5ab2`（仅大小写残留修复）**和**进度契约
      `COLD_BACKUP_PROGRESS_FILE`（引擎仓库那一轮改动，未发布）；
      ② 然后发 `dsh-cold-backup@2.0.0`（`npm run` 走 Release + trusted publishing）；
      ③ 同版本更新市场条目（`docs/market-submission.md` 顶部有提醒：描述 ↔ 代码要对得上）；
      ④ 发版后复核两点：从 npm 装的正式包也带引擎依赖；用户按 README 装 shim 后 git 钩子仍工作。
- [ ] **（可选，未决）** 进度条目前只在「引擎写了进度」时精确；引擎旧版会显示流动条 +
      已用时。要不要在设置里加一句提示，告诉用户「升级引擎就有精确进度」？ —— POST + 信任判据（照抄
      `dsh-archived/lib/host/trust.js`）、T1/T2 默认开、T3（`--verify --fix` /
      `--prune-orphans --apply`）进 UI 但**默认关 + 二次确认**、进度契约（引擎
      `COLD_BACKUP_PROGRESS_FILE` + 插件侧加权进度条）、README / README.en / 市场条目**同版本**改、
      版本 **2.0**。**硬门槛**：引擎先发一版含 `97d5ab2`（仅大小写改名的残留误报修复）——
      否则 T3 的 `--apply` 有删活目录的风险。
      决策与依据：`docs/decisions.md` 的 2026-10-03 条目（含今天的实测证据：104 秒 / 日志无分段 /
      SIGTERM 干净释放锁 / 两个先例插件的信任判据原文）。
- [x] ~~**（改名后新增，优先）给新包名 `dsh-cold-backup` 配 trusted publishing**~~ → **2026-10-03 已配好并核对**：
  用户用网页配好两份，`npm trust list`（经 2FA）读回来是
  `type: github / file: publish.yml / repository: haotian-lu-prog/dsh-cold-backup /
  permissions: publish, stage publish`，与工作流逐项对得上；引擎侧 `cold-backup` 同理。
  旧包两份配置已删除（`npm trust list dsh-dev-backup` → `E404`，即「没有配置」）。
  **OIDC 发布本身还没被真实发版验过**（`workflow_dispatch` 会跳过 publish 步骤）——
  下一次发版即验证；万一 CI 那条路有问题，本机仍可用「浏览器 2FA + 本机 publish」兜底。
- [x] ~~旧包 `dsh-dev-backup` 还没 deprecate~~ → **已 deprecate**（2026-10-02 深夜）：
  registry 上 1.0.0 / 1.1.0 / 1.1.1 三个版本都带上了改名消息；消费者侧实测打
  `npm warn deprecated dsh-dev-backup@1.1.1: Renamed to 'dsh-cold-backup' …`。
  踩坑（包级 `mfa=publish`、必须走 PTY + `--auth-type=web`）与「E422 但其实已生效」的细节
  见「当前状态（六）」。（旧包 README 想改成指向新名只能发新版本，而那个包同样要 2FA —— 不做。）
- [x] ~~**盯 #6410 的 CI**~~ → **三项全绿**（`check` ×2 + `Submission gate`，`mergeable=MERGEABLE`）；
      剩维护者人工评审。文档里的 PR 链接与分支 sha 已同步成 #6410 / `da019ac`。
      旧 #6322 保持 CLOSED 并留有指向 #6410 的说明。
- [x] ~~重新登录 npm 并发布~~ → 已完成，见上一节（含三方校验和比对与从 npm 装的端到端）。
- [x] ~~配 trusted publishing~~ → **已配好，且已改成 allow publish**：1.1.1 是**直接发布**的，
      不再进 staging、不需要在 npm 上批准一次（见「当前状态（五）」）。
- [x] ~~上游联动：把 README / 配置示例从作者私有路径指向公开的 `dev-backup`~~ → 已随 **1.1.1** 发布。
- [x] ~~（需要你定）token 现状因为这次 deprecate 变了~~ → **用户选了 ②，2026-10-03 已收尾**：
  两个新包名都配好 trusted publishing（见上一条，已用 `npm trust list` 核对），
  随后 `npm token revoke 371aff` 成功 —— `npm token list` **现在为空**，用备份里的旧值实测
  `npm whoami` → **401**（确认真死了）。**账号上不再有长期 token。**
  本机 `~/.npmrc` 留的是**网页登录会话 token**（`npm_6qBj…`）：读操作照常，写操作每次要过一遍
  浏览器 2FA —— 也就是说**以后发版别再走本机 `npm publish`，走 CI 的 OIDC**（`publish.yml` +
  Release）。旧 token 值仍备份在 `~/.npmrc.bak-1790953916`（留着不影响安全，它已失效）。
  注：`cold-backup@1.0.3` 是用**旧** token 发的（在撤销之前），不受影响。
- [x] ~~**1.1.1 还没做「真机 Harness E2E」**~~ → **改名这一轮补上了**：
      `docs/evidence/e2e-0.2.0-rc.2.md` 新增第 8 节 —— 隔离 `DSH_HOME`、从 **npm registry**
      装 `dsh-cold-backup@1.1.1`、`--dump-config` 里出现 `# == dsh-cold-backup`、
      `GET /dsh-cold-backup/status` 返真数据（`level=ok`，`freshness.path` 就是本机新日志目录）、
      Client 模块以包名注册、bundle 取回 HTTP 200 / 21592 字节（与仓库 `client.js` 逐字节相同，
      只多服务器追加的 sourceMappingURL）、启动日志无 error/warn。
      **没验的**：GUI 里点开设置页的渲染，以及 provenance（本机构建发的，无 provenance）。
- [ ] ~~配 trusted publishing（原卡点，保留原始记录以免下次又踩）~~：到 npm → `dsh-dev-backup` →
      Settings → Trusted Publisher → GitHub Actions，填 user `haotian-lu-prog` /
      repo `dsh-dev-backup` / workflow `publish.yml`（Environment 留空）并保存（要过 passkey 2FA）。
      **配好后不需要重发 Release**：直接重跑那次失败的 CI 即可 ——
      `gh run rerun 36990764996 -R haotian-lu-prog/dsh-dev-backup`（它会重新走 tag 校验 → 发现
      1.1.0 还不在 registry → `npm publish --provenance`）。
      - 2026-10-02 实测：**CLI 配不了**。`npm trust github dsh-dev-backup --file publish.yml --repo
        haotian-lu-prog/dsh-dev-backup --allow-publish` 先说「Two-factor authentication is required」，
        然后 `E403 403 Forbidden - GET .../-/package/dsh-dev-backup/trust` —— 本机那个开了
        Bypass 2FA 的 granular token 读/写 trust 配置都被拒（npm 正在收紧 bypass-2FA token：
        不再允许改账号设置与直接发布）。**所以只能网页配。**
      - 配好之后建议删掉那个 token（`npm token list` 查，或 Access Tokens 页面删），
        本机再 `npm config delete //registry.npmjs.org/:_authToken`；
        此后发 Release 即自动发布，不再需要任何长期凭据。
- [x] ~~2026-10-01T08:59:35Z 之后开市场 PR~~ → **已提交**：
      <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6322>
  - 开 PR 前先 rebase 到当时的上游 `main`（我们落后 20 个提交），rebase 干净，
    diff 仍是 **+1 文件 / +6 行**；fork 分支现为 `a27ab99d3`。
  - **CI（pr-gate / `check`）已通过**（8m52s）——`check-submission` 的仓库年龄（≥1 天）、
    `dsh.bundle` 清单、非归档、非 DSH 本身全部达标。
  - 剩下是维护者人工评审与合并，不由我们控制。
- [ ] **等 PR 合并后回来确认**：市场列表里出现本插件，并核对 description / 分类是否被维护者调整
      （分类被改是正常维护行为，不是打回）。
- [x] ~~复核 `repository.url`~~ 已确认指向本仓库；条目里**不再**放 `tarball:`
      （`probe-npm` 优先 npm，留着反而是会烂的钉住链接）。
- [ ] 后续改动推 main 会被 pre-push 钩子拦（`dsh-dev-backup` 不在 `_shared` 的白名单里）。
      单维护者的公共插件仓，建议在 `git-hooks/main-push-allow.txt` 里加一行，
      或每次都显式 `ALLOW_MAIN_PUSH=1`（本文件与 Release 说明就是这么推上去的）。
- [ ] 旁注（不属于本仓库）：同作者的 `dsh-notifications` 也已发布 npm，但其市场 PR 尚未开
      （市场里查不到该条目，上游也没有对应 open PR）。它的 HANDOFF 说 PR 已排期——
      如果那是遗留项，需要单独收尾。

## 未决问题

- [x] ~~结构化的只读增强~~ → **已完成**：`backup-dev.sh --status --json`（契约 `dev-backup.status/1`）
  + 本插件的 `statusJsonCommand`，判定权交给脚本。剩下的是「本机没 Swift 工具链」那件事
  （面板侧已改完源码、编译不了，见 `_shared/HANDOFF.md` 未决问题）。
- [x] ~~`1.1.0` 还没发布~~ → **已发布**（2026-10-02T09:44:12Z，带 provenance）。
  市场条目（PR #6322）指向 npm，因此列表里会自动显示 1.1.0，**无需改条目**。
- **默认配置偏「冷备约定」**：`freshnessFile` / `failureFile` 默认指向
  `~/Library/Logs/dev-backup/*`。好处是作者本人开箱即用；代价是陌生人装上后要先改路径才有意义
  （面板会明确提示「尚未配置」，不会假装正常）。是否改成「空默认值 + 引导」，待定。
- **是否做历史曲线**：目前只报当前状态。要画趋势就得让 Host 半侧落一份时间序列，会引入写入行为
  （现在插件是纯只读的），需要重新权衡。
- **是否做历史曲线**：目前只报当前状态。要画趋势就得让 Host 半侧落一份时间序列，会引入写入行为
  （现在插件是纯只读的），需要重新权衡。
