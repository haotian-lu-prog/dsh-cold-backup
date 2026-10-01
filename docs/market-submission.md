# dsh market 投稿（已提交）

**PR：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6322> —— CI 已通过，等维护者评审。**

以下是当时执行的步骤与自查，留作以后更新条目时的参照。

投稿目标：`awesome-dsh-plugin/awesome-dsh-plugin`。
**形态：只加一个文件**，不要改 `README.md` / `README.zh.md`（它们由 `generate-readme.mjs` 生成，
合并后由 sync-readme 在 main 上重跑）。

## 前置条件

| 条件 | 状态 |
|---|---|
| 仓库存在且非归档 | ✓ |
| `package.json` 声明 `dsh.bundle` | ✓（`dsh.bundle.patch`） |
| 仓库创建满 24 小时 | ✓ 已满（建于 `2026-09-30T08:59:35Z`） |
| npm 上有对应包 | ✓ `dsh-dev-backup@1.0.0`（registry 的 `repository.url` 已确认指向本仓库） |

## 要加的文件

`data/plugins/haotian-lu-prog__dsh-dev-backup.yml`

```yaml
url: https://github.com/haotian-lu-prog/dsh-dev-backup
name: haotian-lu-prog/dsh-dev-backup
category: dev
description:
  en: '...'
  zh: '...'
```

分类取 **`dev`**（市场的 "Development & Runtime"）。可选值由
`scripts/lib/entries.mjs` 的 `CAT_IDS` 定义（`agi, ui, usage, theme, model, identity, session,
memory, tools, wsl, browser, vision, voice, docs, skill, workflow, git, notify, dev, security,
remote, market, fun`）。本插件不通知、只显示状态，所以 `notify` 不合适。

**描述必须与代码相符**——市场评审会拿描述去核对代码，夸大是"本来不错却被退回"的头号原因。
当前那两句逐条对得上：成功时间戳文件 / 失败日志 / launchd 状态与退出码 / 可选状态命令，
以及"逐条列出具体原因"（就是 `reasons`）。

### 关于 `tarball:` 字段（曾加过，已移除）

- 市场**推荐**发 npm；没发 npm 时可以加 `tarball:` 指向 GitHub Release 的预构建产物。
  npm 未上架的阶段我们加过它，让安装路径当场可用。
- **npm 发布后已移除**：`scripts/probe-npm.mjs` 的注释写得很明确——它存在的目的就是让
  消费方"**prefer registry installs over full-repo GitHub tarballs**"，即 npm 优先。
  既然 npm 有了，`tarball:` 就是一个被忽略、却钉死在 `v1.0.0` 上会随版本变旧的链接，
  属于自找的腐烂源，所以删掉。
- 记录一下当时为什么钉 tag 而不是 `latest/download/`：后者只在请求时解析 `latest`、
  文件名却按字面取，资产名带版本号时会"提交当天有效、下次发版 404"。

> YAML 注意：`description` 里若出现 `": "`（冒号+空格）必须加引号，否则会被解析成嵌套 mapping
> ——`readEntries()` 专门为这个最常见的错误写了提示。

## 执行步骤

```sh
cd /tmp && rm -rf awesome
git clone --depth 1 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git awesome
cd awesome && npm ci --ignore-scripts

git remote add fork https://github.com/haotian-lu-prog/awesome-dsh-plugin.git
git fetch fork add-dsh-dev-backup
git checkout -b add-dsh-dev-backup fork/add-dsh-dev-backup   # 已推好的分支

# 开 PR 前先跟上上游，避免 fork 落后导致 CI 重跑失败
git fetch --depth 1 origin main
git rebase origin/main
git push --force-with-lease fork add-dsh-dev-backup
```

PR 标题 / 正文：

```text
Add dsh-dev-backup

Backup freshness monitor for the Harness Web UI: reads a last-success timestamp file,
a failure log, a launchd job's state and last exit code, and an optional status command,
then shows in Settings whether the scheduled backup actually ran — and names the specific
reason whenever it did not.

- repo: https://github.com/haotian-lu-prog/dsh-dev-backup
- category: dev
- verified end-to-end on DSH 0.2.0-rc.2 (evidence in the repo's docs/evidence/)
- only adds data/plugins/haotian-lu-prog__dsh-dev-backup.yml
```

## 已做过的干跑（2026-09-30）

对着市场**自己的**脚本跑，而不是凭感觉：

- `slugFor(url)` == 文件名 ✓
- `readEntries()` 解析成功，条目数 4392 → 4393 ✓
- `node --test scripts/added-dates.test.mjs scripts/capabilities.test.mjs scripts/adopt-discussions.test.mjs` → **18/18 通过**
- `GITHUB_TOKEN=<token> node scripts/check-submission.mjs --base <sha>` → **唯一失败项是年龄**
  （"repository is 0.0 days old (needs 1)"），其余（`dsh.bundle` 清单 / 非归档 / 非 DSH 本身）全过
- 分支已推到 fork：`add-dsh-dev-backup` @ `2c26806`，diff **+1 文件 / +6 行**

## 对照 contributing.md 的自查

| 要求 | 状态 |
|---|---|
| 一个文件、按 `<owner>__<repo>.yml` 命名 | ✓ |
| `url` 与仓库完全一致 | ✓ |
| 描述一行、以句号结尾、无营销词 | ✓（已从两行长句改短） |
| 描述与代码相符（评审会核对） | ✓ 逐条对得上 |
| `dsh.bundle`（**不能只有 `dsh.client`**） | ✓ 两者都有 |
| 仓库根有 `cordis.patch.yml` | ✓ |
| 真实可用的代码，非占位 | ✓ 19 项测试 + 真机 E2E |
| 仓库创建满 1 天 | ⏳ 2026-10-01T08:59:35Z |
| `dsh-plugin` topic | ✓ |
| 官方 `@deepseek-ai/*` 走 peerDependencies | ✓ 已从 dependencies 改过来 |
| peer 范围带显式预发布分支 | ✓ `^0.2.0-rc.2` |
| PR 只动自己那一条 | ✓ +1 文件 |
