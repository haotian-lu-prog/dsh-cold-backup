# dsh market 投稿（待执行）

投稿目标：`awesome-dsh-plugin/awesome-dsh-plugin`。
**形态：只加一个文件**，不要改 `README.md` / `README.zh.md`（它们由 `generate-readme.mjs` 生成，
合并后由 sync-readme 在 main 上重跑）。

## 前置条件

| 条件 | 状态 |
|---|---|
| 仓库存在且非归档 | ✓ |
| `package.json` 声明 `dsh.bundle` | ✓（`dsh.bundle.patch`） |
| 仓库创建满 24 小时 | ⏳ 建于 `2026-09-30T08:59:35Z` → **`2026-10-01T08:59:35Z` 后可提** |
| npm 上有对应包 | ⏳ 未上架（`probe-npm.mjs` 会据 registry 的 `repository.url` 决定展示安装命令还是构建命令；没有 npm 包也不阻塞合并，但市场卡片会退化成源码构建） |

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

> YAML 注意：`description` 里若出现 `": "`（冒号+空格）必须加引号，否则会被解析成嵌套 mapping
> ——`readEntries()` 专门为这个最常见的错误写了提示。

## 执行步骤

```sh
cd /tmp && rm -rf awesome
git clone --depth 1 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git awesome
cd awesome && npm ci --ignore-scripts

git remote add fork https://github.com/haotian-lu-prog/awesome-dsh-plugin.git
git fetch fork add-dsh-dev-backup
git checkout -b add-dsh-dev-backup fork/add-dsh-dev-backup   # 上一轮已推好的分支

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

- `slugFor(url)` == 文件名 ✓
- `readEntries()` 解析成功，条目数 4392 → 4393 ✓
- `node --test scripts/added-dates.test.mjs scripts/capabilities.test.mjs scripts/adopt-discussions.test.mjs` → **18/18 通过**
- `GITHUB_TOKEN=<token> node scripts/check-submission.mjs --base <sha>` → **唯一失败项是年龄**
  （"repository is 0.0 days old (needs 1)"），其余（`dsh.bundle` 清单 / 非归档 / 非 DSH 本身）全过
- 分支已推到 fork：`add-dsh-dev-backup` @ `0c43f51`，diff **+1 文件 / +6 行**
