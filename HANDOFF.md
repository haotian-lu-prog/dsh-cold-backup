# HANDOFF

> 三家的接力棒：DSH / Codex / Claude Code 都读这个文件。**开工先读，收工必更新并提交。**

## 当前写者

- 工具：（空 —— 2026-09-30 DSH 会话已收工）
- 分支：main
- 开始时间：—

> 一个仓库同一时刻只允许一个写者。下一位把上一行改成自己，并先读完下面的状态。

## 当前状态

**插件已写完并在真实 Harness 上端到端验证通过；尚未发布。**

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
- 关键取舍与两个实测踩坑：见 `docs/decisions.md`。

## 下一步

- [ ] **npm 发布被阻塞：本机 npm 未登录**（`npm whoami` → `E401 Unauthorized`）。
      需要人工跑一次 `npm login`；之后 `npm publish` 即可（`publishConfig` 已设 public）。
- [ ] 建 GitHub 公开仓库 `haotian-lu-prog/dsh-dev-backup` 并推送（`gh` 已登录：
      `gh repo create dsh-dev-backup --public --source . --push`）。
- [ ] 建 `v1.0.0` Release 并附 `npm pack` 的 tarball（校验和要与 npm registry 的一致）。
- [ ] 加 topics：`dsh-plugin` 等。
- [ ] 投稿 dsh market：往 `awesome-dsh-plugin/awesome-dsh-plugin` 的
      `data/plugins/<owner>__<repo>.yml` **加一个文件**（不要改 README，README 由脚本生成）。
      **CI 要求仓库创建满 24 小时**，所以建仓当天不能提 PR。
      参考同作者的 `dsh-notifications` 走过的同一条路（其 HANDOFF 记录了完整形态）。
- [ ] 复核：市场脚本 `scripts/probe-npm.mjs` 从仓库 HEAD 的 `package.json` 取包名，再要求 registry 的
      `repository.url` 含该仓库路径 —— 本包已满足
      （`git+https://github.com/haotian-lu-prog/dsh-dev-backup.git`）。

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
