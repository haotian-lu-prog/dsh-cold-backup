# AGENTS.md — dsh-cold-backup

DeepSeek Harness 插件（bundle）：在 Harness Web UI 里加一页「备份」，显示定时备份的新鲜度。
Host 半侧读状态文件 / `launchctl` / 状态命令，Client 半侧画面板。

## 运行

- 安装依赖：`npm install`
- 测试：`npm test`（`node --test`，28 项；不需要真实 Harness）
- 打包：`npm pack`
- 端到端验证：见 `docs/evidence/e2e-0.2.0-rc.2.md`（隔离 `DSH_HOME` + `web` 模板 profile）

## 约定

- 工作区总则见各工具 home 的全局指令（`~/.dsh/AGENTS.md` 等）；本文件只写**本项目特有**的内容。
- 开工先读 `HANDOFF.md`；收工更新它（当前状态、下一步、未决问题）并提交。
- 有取舍的决策追加到 `docs/decisions.md`。

## 三条容易踩的硬约束（都有测试守着）

1. **四者必须同名**：`package.json` 的 `name`、`cordis.patch.yml` 的 `id`/`name`、`index.js` 的
   `ENTRY_ID`、`client.js` 里 `__ModuleLoader__.load({ id })` —— Harness 按**包名**索引客户端模块表，
   不一致时 Client 半侧会**静默不加载**（不报错，只是页面不出现）。测试
   「the package name, patch id, ENTRY_ID and client module id all agree」会拦下。
2. **peer 范围必须保留显式预发布分支**（`^0.2.0-rc.2`）。node-semver 只在范围里存在与目标版本
   `major.minor.patch` 元组相同、且自带预发布标签的比较符时才放行预发布版本；写成
   `>=0.2.0-rc.2 <0.3.0` 之类会**静默排除所有 harness 预发布构建**。
3. **配置字段要 `volatile()`**，且读取时兼容「引用」与「纯值」两种形态（见 `index.js` 的
   `readField`）。只写 `.get()` 会在非 volatile 字段上直接抛错 —— 本插件第一版就是这么挂的，
   `/dsh-cold-backup/status` 返回 500 `collection-failed`。

## 结构

- `index.js` — Host 半侧：`Config` 声明、纯函数解析（`parseLaunchctlPrint` / `readTimestamp` /
  `readLastFailureLine`）、`evaluateStatus` 健康判定、`collectStatus`（依赖可注入，便于测试）、
  以及 `/dsh-cold-backup/status` 路由
- `client.js` — Client 半侧：`settings.section` 一页「备份」，中英双语，按 `refreshSeconds` 轮询
- `cordis.patch.yml` — profile patch 入口行
- `test/plugin.test.js` — `node --test` 套件
- `docs/decisions.md` / `docs/evidence/` — 决策与验证证据
