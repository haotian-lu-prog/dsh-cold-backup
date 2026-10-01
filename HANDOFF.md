# HANDOFF

> 三家的接力棒：DSH / Codex / Claude Code 都读这个文件。**开工先读，收工必更新并提交。**

## 当前写者

- 工具：（空 —— 2026-09-30 DSH 会话已收工）
- 分支：main
- 开始时间：—

> 一个仓库同一时刻只允许一个写者。下一位把上一行改成自己，并先读完下面的状态。

## 当前状态

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

- [x] ~~重新登录 npm 并发布~~ → 已完成，见上一节（含三方校验和比对与从 npm 装的端到端）。
- [ ] **（需要人工）配 trusted publishing，然后删掉临时 token**：
      到 npm → `dsh-dev-backup` → Settings → Trusted Publisher，填
      user `haotian-lu-prog` / repo `dsh-dev-backup` / workflow `publish.yml`（Environment 留空）。
      配好后删掉那个开了 Bypass 2FA 的 granular access token（`npm token list` 可查，
      或到 Access Tokens 页面删），本机再执行 `npm config delete //registry.npmjs.org/:_authToken`。
      之后发 Release 即自动发布，不再需要任何长期凭据。
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

- **默认配置偏「冷备约定」**：`freshnessFile` / `failureFile` 默认指向
  `~/Library/Logs/dev-backup/*`。好处是作者本人开箱即用；代价是陌生人装上后要先改路径才有意义
  （面板会明确提示「尚未配置」，不会假装正常）。是否改成「空默认值 + 引导」，待定。
- **是否做历史曲线**：目前只报当前状态。要画趋势就得让 Host 半侧落一份时间序列，会引入写入行为
  （现在插件是纯只读的），需要重新权衡。
- **是否做历史曲线**：目前只报当前状态。要画趋势就得让 Host 半侧落一份时间序列，会引入写入行为
  （现在插件是纯只读的），需要重新权衡。
