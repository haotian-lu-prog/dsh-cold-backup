# HANDOFF

> 三家的接力棒：DSH / Codex / Claude Code 都读这个文件。**开工先读，收工必更新并提交。**

## 当前写者

- 工具：（空 —— 2026-09-30 DSH 会话已收工）
- 分支：main
- 开始时间：—

> 一个仓库同一时刻只允许一个写者。下一位把上一行改成自己，并先读完下面的状态。

## 当前状态

**插件已写完、真机验证通过；GitHub 已公开＋已发 Release；npm 上架卡在登录。**

- 目标：把 dev-backup 做成 DSH 插件 → 上传 npm + GitHub → 申请加入 dsh market，
  让人能在 **DSH 0.2.0-rc.2** 的 UI 里看备份实时状态。
- 形态：第三方 bundle 插件，`settings.section` 一页「备份」。Host 半侧读
  成功时间戳文件 / 失败日志 / `launchctl` / 可选状态命令，归一成 `ok|warn|bad|unknown`
  ＋机器可读的 `reasons`，在 `/dsh-dev-backup/status` 上出 JSON；Client 半侧轮询并画面板（中英双语）。
- 本地验证：
  - `npm test` → **16/16 通过**（含 Client 半侧用 stub 的 `__ModuleLoader__` 真实加载、
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
- **npm 尚未上架，且被登录阻塞**：
  - `npm whoami` → `E401 Unauthorized`。
  - 直接尝试 `npm publish --access public` → **`E404` on `PUT /dsh-dev-backup`**
    （npm 对"无权限创建包名"返回 404 而不是 401，避免泄露包名是否存在）。两者都指向认证，不是包不合法。
  - `npm publish --dry-run` 本身**通过**（7 个文件、14.6 kB、npm shasum
    `2219d3ddd8913e23cc454381418c28a34ad2395f`），说明包是合格的。
  - 诊断：`~/.npmrc` 里**有** `//registry.npmjs.org/:_authToken`（mtime 2026-09-29 18:31，
    正是发布 `dsh-notifications` 那次），npm 也确实在读这个文件（`npm config get userconfig` 指向它），
    但 registry 现在拒绝它 —— **令牌已过期或被吊销**。
    旁证：`npm view dsh-notifications version` 仍是 `1.0.0`（公开读），说明当时那次发布确实成功过。
  - **需要人工**：`npm login`（或到 npm 建一个 granular access token 覆盖 `~/.npmrc` 里那行）。
    登录后立即发布，因为 web 登录签发的 token 可能不长命。
  - 参考实现 `dsh-notifications` 的 `.github/workflows/publish.yml` 用的是
    **npm trusted publishing（OIDC）**，仓库里不存 token。本仓库已照抄一份：
    首次上架后到 npm 的 Package → Settings → Trusted Publisher 配一次，
    之后发 Release 就自动发布、无需任何 token。
- **dsh market 投稿已备好并干跑验证通过**（2026-09-30，未开 PR）：
  - 投稿形态：往 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/<owner>__<repo>.yml`
    **只加一个文件**。本仓库的条目：`data/plugins/haotian-lu-prog__dsh-dev-backup.yml`，
    分类 **`dev`**（市场的 "Development & Runtime"；`notify` 不合适——本插件不通知，只显示状态）。
  - 干跑（浅克隆 + `npm ci` + 切分支 + 提交，再跑市场自己的脚本）：
    - `slugFor(url)` == 文件名 ✓；`readEntries()` 解析成功，条目总数 4392 → **4393** ✓
    - 仓库自带测试 `added-dates` / `capabilities` / `adopt-discussions` → **18/18 通过** ✓
    - **`scripts/check-submission.mjs`（带真 GITHUB_TOKEN）→ 唯一失败项就是年龄**：
      "repository is 0.0 days old (needs 1) — nothing to do: this check re-runs by itself and
      should clear in about 24h"。也就是说 `dsh.bundle` 清单、非归档、非 DSH 本身这几项**都已经过了**。
  - 分支已推到 fork（不在 `/tmp`，不会丢）：
    `haotian-lu-prog/awesome-dsh-plugin` 分支 `add-dsh-dev-backup` @ `0c43f51`，diff **+1 文件 / +6 行**。
  - 年龄门槛：仓库建于 `2026-09-30T08:59:35Z` → **`2026-10-01T08:59:35Z` 之后**才能提 PR。
- **CI 已补齐**（本轮新增）：`.github/workflows/conventions.yml`（与工作区模板逐字节一致）
  与 `.github/workflows/publish.yml`（trusted publishing 发布流水线）。
- 关键取舍与实测踩坑：见 `docs/decisions.md`。

## 下一步

- [ ] **（需要人工，一步）重新登录 npm**：`npm login`（`~/.npmrc` 里现有 token 已失效）。
      登录后我就能 `npm publish`，并把 registry tarball 的 shasum 与本地 `npm pack` /
      GitHub Release asset 做三方比对，记回本文件。
- [ ] 上架后到 npm 的 **Package → Settings → Trusted Publisher** 配一次
      （user `haotian-lu-prog` / repo `dsh-dev-backup` / workflow `publish.yml`），
      之后发 Release 即自动发布；顺便手动跑一次 `workflow_dispatch` 当作带依赖的彩排。
- [ ] 复核 npm 上 `repository.url` 指向本仓库（市场脚本 `scripts/probe-npm.mjs` 依赖这一点
      来展示安装命令与版本号，而不是源码构建命令）。
- [ ] **2026-10-01T08:59:35Z 之后**开市场 PR：fork 分支 `add-dsh-dev-backup` 已就绪
      （`0c43f51`，+1 文件 / +6 行）。开 PR 前先 `git fetch upstream && git rebase upstream/main`
      再推一次，避免 fork 落后导致 CI 重跑失败。**只加 yml，不要提交生成出来的两个 README**。
- [ ] 后续改动推 main 会被 pre-push 钩子拦（`dsh-dev-backup` 不在 `_shared` 的白名单里）。
      单维护者的公共插件仓，建议在 `git-hooks/main-push-allow.txt` 里加一行，
      或每次都显式 `ALLOW_MAIN_PUSH=1`（本文件与 Release 说明就是这么推上去的）。
- [ ] 旁注（不属于本仓库）：同作者的 `dsh-notifications` 也已发布 npm，但其市场 PR 尚未开
      （市场里查不到该条目，上游也没有对应 open PR）。它的 HANDOFF 说 PR 已排期——
      如果那是遗留项，需要单独收尾。

## 未决问题

- **包名**：暂定 `dsh-dev-backup`（贴合上游「dev-backup」这个称呼）。若更看重陌生人检索，
  `dsh-backup-status` 更通用 —— 但改名要同步四处标识（见 `AGENTS.md`），越早越好。
- **默认配置偏「冷备约定」**：`freshnessFile` / `failureFile` 默认指向
  `~/Library/Logs/dev-backup/*`。好处是作者本人开箱即用；代价是陌生人装上后要先改路径才有意义
  （面板会明确提示「尚未配置」，不会假装正常）。是否改成「空默认值 + 引导」，待定。
- **market 分类**：`dsh-notifications` 用的是 `notify`；本插件更接近 `devops` / `backup` 之类，
  投稿前要看上游 `data/plugins/*.yml` 的现有分类枚举。
- **是否做历史曲线**：目前只报当前状态。要画趋势就得让 Host 半侧落一份时间序列，会引入写入行为
  （现在插件是纯只读的），需要重新权衡。
