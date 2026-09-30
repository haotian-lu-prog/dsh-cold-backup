# 决策记录

倒序追加。每条写清：背景、选项、结论、代价。三家工具都读这个文件，所以**不要只把决定留在会话里**。

---

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
