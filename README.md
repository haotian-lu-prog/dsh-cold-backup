[English](https://github.com/haotian-lu-prog/dsh-dev-backup/blob/main/README.en.md) | 简体中文

# dsh-dev-backup

[![npm 版本](https://img.shields.io/npm/v/dsh-dev-backup)](https://www.npmjs.com/package/dsh-dev-backup)
[![许可证](https://img.shields.io/npm/l/dsh-dev-backup)](LICENSE)
[![Node](https://img.shields.io/node/v/dsh-dev-backup)](package.json)

`dsh-dev-backup` 是一个纯第三方 DeepSeek Harness 插件：在 Harness 的 Web UI 里加一页「备份」，
回答一个问题——**我的定时备份到底跑了没有、最近一次成功是什么时候**。

它读的是「冷备约定」留下的三样东西，任何满足下面任一条的备份方案都能接入：

| 来源 | 含义 | 怎么读 |
|---|---|---|
| 成功时间戳文件 | 最近一次**成功**的时间 | 文件内容为 epoch 秒；不是纯数字就退回用文件 mtime |
| 失败日志 | 最近一次**出问题**的记录 | 取最后一行（约定会追加，所以最后一行最新） |
| launchd 任务 | 定时任务是否加载、上次退出码 | `launchctl print gui/<uid>/<label>` |
| 状态命令（可选） | 任意自检命令 | 退出码 0 视为正常，输出会显示在面板里 |

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
- **零运行时依赖** —— Host 半侧只用 node 内置模块，唯一的 dependency 是 `@deepseek-ai/schemastery`
  （只用来声明 Config）。

## 要求

- Node.js `^22.19` 或 `>=24`
- DeepSeek Harness **`0.2.0-rc.2`**（本版本已实测；见 `docs/evidence/`）
- `launchd` 那一项仅 macOS 可用，其他来源跨平台

## 安装

装进一个自带 Web 界面的 profile。包本身不含任何指向 Harness 检出目录的路径依赖，
`dsh.bundle` 里的 patch 会自动把 Host 与 Client 两行插件接进去：

```sh
dsh --profile web-backup --from-default-profile web --dump-config
dsh plugin --profile web-backup add dsh-dev-backup
dsh --profile web-backup
```

装本地构建的 tarball 也行：

```sh
npm pack
dsh plugin --profile web-backup add ./dsh-dev-backup-1.0.0.tgz
```

## 配置

在 **设置 → 插件 → dsh-dev-backup** 里改，全部字段都标了 `volatile()`，改完立即生效、不用重启：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `freshnessFile` | `~/Library/Logs/dev-backup/last-ok` | 最近成功时间戳文件 |
| `failureFile` | `~/Library/Logs/dev-backup/last-failure` | 失败记录（留空关闭） |
| `launchdLabel` | 空 | 要检查的 LaunchAgent label（留空关闭） |
| `statusCommand` | 空 | 可选自检命令，退出码 0 视为正常 |
| `staleAfterHours` | `36` | 超过这么多小时没成功就报「需要留意」 |
| `refreshSeconds` | `30` | 面板轮询间隔 |

默认值直接对应**冷备约定**（`last-ok` 存 epoch 秒、`last-failure` 追加记录）。
换成别的备份方案时，只要把路径指过去即可，不需要这个约定本身。

举例：如果你的备份是 launchd 任务 `com.example.nightly-backup`、成功时间写在 `~/.backup/last-ok`，
就把 `launchdLabel` 填 `com.example.nightly-backup`、`freshnessFile` 填 `~/.backup/last-ok`。

## 它是怎么工作的

```
Host 半侧 (index.js)                      Client 半侧 (client.js)
  ├─ 读状态文件 / launchctl / 状态命令       ├─ 往 settings.section 注册一页「备份」
  ├─ evaluateStatus() 归一成 ok/warn/       ├─ 按 refreshSeconds 轮询 Host 的路由
  │  bad/unknown + 机器可读的 reasons        └─ 中英双语，列出每条 reason
  └─ 在 /dsh-dev-backup/status 上出 JSON
```

健康判定与解析全是纯函数，`node --test` 覆盖 16 项，不需要真实 Harness 即可跑：

```sh
npm test
```

## 与冷备约定（dev-backup）的关系

本插件是**冷备方案的 UI 前端**，不替代备份本身。冷备方案指的是：一个定时任务把
「最近成功时间」写进一个文件、把失败追加进一个日志，需要时再配一个 launchd 任务兜底。
插件只读这些产物，不写、不触发、不删除任何东西——所以它可以安全地常开。

## 许可证

MIT，见 [LICENSE](LICENSE)。
