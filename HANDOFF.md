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
- **npm 尚未上架，且被登录阻塞**：`npm whoami` → `E401 Unauthorized`。
  `npm publish --dry-run` 本身**通过**（7 个文件、包大小 14.6 kB、npm shasum
  `2219d3ddd8913e23cc454381418c28a34ad2395f`），说明包是合格的，只差一次 `npm login`。
- 关键取舍与实测踩坑：见 `docs/decisions.md`。

## 下一步

- [ ] **（需要人工）`npm login`**，然后 `cd ~/dev/dsh-dev-backup && npm publish`。
      上架后把 registry tarball 的 shasum 与本仓库 `npm pack` / Release asset 做三方比对，
      记回本文件（参考 `dsh-notifications` 的做法）。
- [ ] 复核 npm 上 `repository.url` 指向本仓库（市场脚本 `scripts/probe-npm.mjs` 依赖这一点
      来展示安装命令与版本号，而不是源码构建命令）。
- [ ] 投稿 dsh market：往 `awesome-dsh-plugin/awesome-dsh-plugin` 的
      `data/plugins/<owner>__<repo>.yml` **加一个文件**（不要改 README，README 由脚本生成）。
      **CI 要求仓库创建满 24 小时** —— 本仓库 `createdAt = 2026-09-30T08:59:35Z`，
      即 **2026-10-01T08:59:35Z 之后**才可提 PR。
      参考同作者的 `dsh-notifications` 走过的同一条路（其 HANDOFF 记录了完整形态与投稿内容）。
- [ ] 投稿前先定 market 分类：查上游 `data/plugins/*.yml` 的现有枚举，
      `dsh-notifications` 用的是 `notify`，本插件更接近 `backup` / `devops` 之类。
- [ ] 后续改动推 main 会被 pre-push 钩子拦（`dsh-dev-backup` 不在 `_shared` 的白名单里）。
      单维护者的公共插件仓，建议在 `git-hooks/main-push-allow.txt` 里加一行，
      或每次都显式 `ALLOW_MAIN_PUSH=1`（本文件与仓库的发布说明就是这么推上去的）。

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
