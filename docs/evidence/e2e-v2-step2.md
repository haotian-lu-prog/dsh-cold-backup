# E2E 证据 — v2.0 第 2 步：动作层（信任判据 / 动作 / 进度 / 取消）

日期：2026-10-03 22:15–22:35 +0900
被测：`dsh-cold-backup@2.0.0`（工作树打的 tarball）+ 引擎侧**未发布**的进度契约
方法：一次性 profile `cb-e2e2`（真实 `DSH_HOME`，`--from-default-profile web` 生成）+
独立端口 `19997`，**不碰在用的 `desktop`**。装包走 `dsh plugin --profile cb-e2e2 add <tarball>`
（pnpm `+2 packages` = 插件 + `cold-backup@1.0.3`）。
进度那一组额外把 profile 里的引擎换成**工作区的引擎**（进度契约还没发布，见第 5 节的说明）。

验收依据：`docs/decisions.md` 的 2026-10-03「v2.0 定案」（动作边界 / 安全模型 / 进度契约）。

## 1. 信任判据（`trust.js`）

| 请求 | 结果 |
|---|---|
| `POST /action` + `sec-fetch-site: cross-site` + 标记头 | **403** `{"error":"untrusted-request","reasons":["cross-site"]}` |
| `POST /action` 无任何浏览器信号、也无标记头 | **403** `reasons:["missing-marker"]` |
| `POST /action` + 标记头 + `{"action":"rm-rf"}`（表里没有） | **400** `{"error":"unknown-action","allowed":["backup","verify","daily","verifyFix","prune"]}` |
| `POST /action` + 标记头 + `{"action":"prune"}`（`allowDestructive` 默认 false） | **403** `{"error":"destructive-disabled"}` |
| `POST /status`（读路由动词限制） | **405**（第 1 步的只读形状没变） |
| `GET /job`（还没有作业） | **200** `{"job":null}` |

跨站那条是这套模型的核心：恶意网页对 `127.0.0.1` 发起的 fetch 一律被拒；而**桌面 app 走自己
请求管道**（不带 Fetch Metadata 头）时靠标记头 `x-dsh-cold-backup: 1` 通过 —— 这正是
`dsh-archived` 那次真实故障换来的判据顺序。

## 2. 动作生命周期

```
POST /action {"action":"backup"} + 标记头        → 202 {"job":{"id":"job-musf7uf6-1", …,"running":true}}
pgrep -fl cold-backup                            → 94133 /bin/bash …/cb-e2e2/node_modules/cold-backup/bin/cold-backup --trigger=ui
POST /action {"action":"verify"}（作业运行中）    → 409 {"error":"busy","running":"backup"}
GET  /job                                        → running=true，percent=null（那时的引擎是 npm 上那份，见 §5）
POST /cancel + 标记头                             → 200 {"cancelled":true}
（3 秒后）进程                                     → 已退出
（3 秒后）~/Library/Logs/cold-backup/.lock         → **已释放**（引擎的 EXIT trap 生效）
```

「取消不留死锁」这条在第 1 步就单独实测过，这里是端到端复核：取消之后**不需要**等 15 分钟陈旧锁
判定，下一次动作立刻能起来。

## 3. T3 打开之后

在 profile 的 patch 层写 `allowDestructive: true` 后：

```
GET  /status → config.allowDestructive: true     # 配置热生效，不用重启
POST /action {"action":"prune"} + 标记头 → 202   # 被接受
（该动作很快结束：当时云盘里没有残留，删了 0 个）
```

## 4. 进度（三阶段真机轨迹）

`POST /action {"action":"daily"}`，每 10 秒采一次 `GET /job`：

```
t+ 10s percent=1    phase=backup  backup={done:9,total:17}  verify={done:0,total:0}    current=dsh
t+ 50s percent=49   phase=backup  backup={done:11,total:17} verify={done:0,total:0}    current=plugins
t+ 70s percent=83   phase=verify  backup={done:17,total:17} verify={done:54,total:107} current=dsh
t+100s percent=85   phase=verify  backup={done:17,total:17} verify={done:64,total:107} current=dsh-system
t+120s percent=100  phase=status  backup={done:17,total:17} verify={done:107,total:107}
最终: {"percent":100,"phase":"status","exitCode":0,"engineFinished":true,
       "engineMs":115000,"elapsedMs":115932}
```

观察到的三件事，都符合设计：

1. **百分比是单调的**，阶段之间不回落（三阶段按 0.7 / 0.25 / 0.05 加权，见 `actions.js`）；
2. **计数是精确的**：备份 17 个目标、校验 **107** 份产物，逐个来自引擎的 `start`/`done` 事件；
3. **按工作量加权，不是按个数**：备份阶段 9/17 时只有 **1%** —— 因为剩下的是两个数百 MB 的快照
   （`dsh` / `plugins`），权重按产物字节数算；它们完成时百分比才跳到 49%。面板同时显示精确计数与
   当前目标，并在运行期间写明「百分比按阶段加权估算；各阶段的计数是精确的」。

同一套解析还单独用引擎的原始输出验过一次（临时夹具，`--daily` 10 条事件）：

```
{"v":1,"phase":"plan","section":"backup","total":2,"units":[{"kind":"repo","label":"demo","weight":0}, …]}
{"v":1,"phase":"backup","state":"start","kind":"repo","label":"demo"}
{"v":1,"phase":"backup","state":"done","kind":"repo","label":"demo","result":"stored","ms":1000}
…
{"v":1,"phase":"plan","section":"verify","total":2,"units":[…]}
{"v":1,"phase":"verify","done":1,"total":2,"label":"demo","ok":true}
{"v":1,"phase":"status"}
{"v":1,"done":true,"exitCode":0,"ms":1000}
```

`parseProgress + summarizeProgress` 对它的结果：10 条事件 → `percent 100`、三段计数
`{backup 2/2, verify 2/2, status 1/1}`、`finished=true`、`exitCode=0`。

## 5. 已知限制与说明

1. **进度契约还没发布**：npm 上的 `cold-backup@1.0.3` 不写进度文件，所以本节的进度轨迹是把
   profile 里的引擎换成工作区那份跑出来的。装上 2.0.0 而引擎仍是 1.0.3 时，`percent` 为 `null`、
   面板画**流动条**并显示已用时 —— 不编数字（这一条也在 §2 里被真实观察到）。
   **发 2.0 前必须先发含进度契约的引擎版本。**
2. **动作会真的改数据**：本节实际跑了 `backup` 与 `daily`（等于这台机器平时的备份），以及一次
   `--prune-orphans --apply`（当时云盘里没有残留，删除 0 个）。没有构造「损坏产物 + `--fix`」的
   场景去验删除路径 —— 那属于引擎自己的自测覆盖（见引擎仓库 `test/selftest.sh`）。
3. **同一时刻只有一个作业**（409），且动作互斥是进程级的：`/job` 只反映最近一个作业。

## 6. 清理

宿主（端口 19997）已停、一次性 profile `cb-e2e2` 已删、全局 CLI 未被触碰（本次没卸它）、
`.lock` 已释放、`~/Library/Logs/cold-backup/progress/` 里的作业进度文件随作业结束被删。
