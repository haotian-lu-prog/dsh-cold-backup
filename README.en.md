English | [简体中文](https://github.com/haotian-lu-prog/dsh-cold-backup/blob/main/README.md)

# dsh-cold-backup

[![npm version](https://img.shields.io/npm/v/dsh-cold-backup)](https://www.npmjs.com/package/dsh-cold-backup)
[![license](https://img.shields.io/npm/l/dsh-cold-backup)](LICENSE)
[![Node](https://img.shields.io/node/v/dsh-cold-backup)](package.json)

A third-party DeepSeek Harness plugin that adds a **Backup** page to the Harness Web UI and answers
one question: *did my scheduled backup actually run, and when did it last succeed?*

It reads whatever a backup job leaves behind, so any scheme that can provide one of these works:

| Source | Meaning | How it is read |
|---|---|---|
| Freshness file | Time of the last **success** | Epoch seconds in the file; falls back to mtime when the content is not a bare number |
| Failure log | The most recent **problem** | Last line (the convention appends, so the last line is newest) |
| launchd job | Whether the timer is loaded, and its last exit code | `launchctl print gui/<uid>/<label>` |
| Status command (optional) | Any self-check | Exit code 0 is healthy; its output is shown in the panel |
| JSON status command (optional) | A structured status document | Runs a command (e.g. `cold-backup --status --json`) and reads its `cold-backup.status/1` JSON; **when it parses, it wins**, and its per-target detail is shown |

One rule is worth remembering: **a failure is reported unless a later success supersedes it**.
The comparison is `>=`, not `>` — a single run can write the success timestamp and record a failure
in the same second, and `>` would silently hide exactly that case (see `docs/decisions.md`).

## Features

- **Freshness at a glance** — the panel opens with a status dot and a verdict:
  OK / Needs attention / Problem / Not configured.
- **It explains itself** — not just a colour, but the specific reasons (stale by N hours, status file
  missing, launchd job not loaded, non-zero exit code, failure not superseded…), in English and Chinese.
- **Auto refresh** — polls the Host route while the panel is open, plus a manual Refresh button.
- **Identity that cannot drift** — the package name, `cordis.patch.yml` id, Host `ENTRY_ID` and Client
  module id are pinned together by a test. When these four disagree the Client half *silently never
  loads*, which is the usual way plugins of this kind break.
- **Bundled engine (v2.0)** — this package declares `cold-backup` as a dependency, so installing the
  plugin installs the engine: no separate `npm i -g cold-backup`. The panel runs
  `cold-backup --status --json` by default and says which engine answered (bundled dependency / PATH /
  your own configured command). When no engine resolves it falls back to the generic sources **and
  names the missing engine** instead of pretending everything is fine. Want it strictly passive (no
  resolution, no process ever started)? Turn `bundledEngine` off.
- **Optional actions (v2.0)** — the panel can start a backup, verify everything, or run the daily
  check, with a **progress bar** (the percentage weighs phases; the per-phase counters are exact;
  an older engine that writes no progress gets a moving stripe instead of a made-up number). The two
  destructive actions (`--verify --fix`, `--prune-orphans --apply`) are **off by default** and take
  two clicks once enabled. Want it to never touch anything? Turn `allowActions` off.
- **The Host half uses node builtins only** — the only npm dependencies unrelated to Harness are
  `@deepseek-ai/schemastery` (Config declaration) and the engine package `cold-backup` (a bash
  script; nothing is loaded into the JS runtime).

## Requirements

- Node.js `^22.19` or `>=24`
- DeepSeek Harness **`0.2.0-rc.2`** (verified; see `docs/evidence/`)
- The `launchd` source is macOS-only; every other source is cross-platform
- The bundled engine is a bash script: **macOS 3.2+ / Linux**. On Windows it is not installed (the
  package declares `os`), the panel reports `engine-missing`, and the generic sources still work

## Install

Install into a profile that serves the Web UI. The package carries no path dependency back to a
Harness checkout, and its `dsh.bundle` patch wires both the Host and Client plugin rows in:

```sh
dsh --profile web-backup --from-default-profile web --dump-config
dsh plugin --profile web-backup add dsh-cold-backup
dsh --profile web-backup
```

A locally built tarball works too:

```sh
npm pack
dsh plugin --profile web-backup add ./dsh-cold-backup-<version>.tgz
```

**The engine comes along**: `cold-backup` is a dependency of this package, so either command above
installs it into the same profile — no extra global install.

**To let git hooks / cron / other tools call the engine too** (they only know `cold-backup` on
PATH), install one stable entry point. It resolves the path **at run time**, so upgrading the
dependency never leaves a dangling symlink:

```sh
mkdir -p ~/.local/bin && cat > ~/.local/bin/cold-backup <<'SH'
#!/bin/sh
for p in "$HOME"/.dsh/profiles/*/node_modules/cold-backup/bin/cold-backup; do
  [ -f "$p" ] && exec /bin/bash "$p" "$@"
done
for p in /opt/homebrew/bin/cold-backup /usr/local/bin/cold-backup; do
  [ -x "$p" ] && exec "$p" "$@"
done
printf 'cold-backup: engine not found (install dsh-cold-backup, or npm i -g cold-backup)\n' >&2
exit 127
SH
chmod +x ~/.local/bin/cold-backup
```

Delete it whenever you like: the plugin then goes back to "PATH only".

## Configuration

Everything lives under **Settings → Plugins → dsh-cold-backup**. All fields are `volatile()`, so edits
apply immediately without a restart:

| Field | Default | Meaning |
|---|---|---|
| `freshnessFile` | `~/Library/Logs/cold-backup/last-ok` | File holding the last success timestamp |
| `failureFile` | `~/Library/Logs/cold-backup/last-failure` | Failure log (empty disables it) |
| `launchdLabel` | empty | LaunchAgent label to inspect (empty disables it) |
| `statusCommand` | empty | Optional self-check; exit code 0 is healthy |
| `statusJsonCommand` | empty | Optional: a command printing a `cold-backup.status/1` document (e.g. `cold-backup --status --json`). When it parses, its verdict drives the panel and its per-target detail is rendered. Left empty, the bundled engine is used instead (highest priority; this is **operator configuration** and is never reused by anything that writes) |
| `allowActions` | `true` | Let the panel start actions (backup / verify / daily). Off: every action route answers 403 and the plugin is purely read-only |
| `allowDestructive` | `false` | Also allow the two destructive actions (`--verify --fix`, `--prune-orphans --apply`). Off by default: they delete artifacts, and the UI asks for a second confirmation on top |
| `bundledEngine` | `true` | Resolve and use the engine this package depends on (falling back to PATH). Turn off to keep the plugin strictly passive: file / launchd sources only, nothing resolved, no process started |
| `staleAfterHours` | `36` | Older than this many hours is reported as stale |
| `refreshSeconds` | `30` | Panel polling interval |

The defaults describe the **cold-backup convention** (`last-ok` holds epoch seconds, `last-failure` is
appended to) — and they are exactly where the companion engine
[`cold-backup`](https://www.npmjs.com/package/cold-backup) puts them on macOS, so "cold-backup + this
plugin" needs **no configuration at all**. Point the paths somewhere else to use any other backup
scheme — the convention itself is not required.

For example, if your backup is a launchd job named `com.example.nightly-backup` that writes its
success timestamp to `~/.backup/last-ok`, set `launchdLabel` to `com.example.nightly-backup` and
`freshnessFile` to `~/.backup/last-ok`.

## How it works

```
Host half (index.js)                       Client half (client.js)
  ├─ reads status files / launchctl / cmd    ├─ registers a "Backup" page on settings.section
  ├─ evaluateStatus() → ok/warn/bad/         ├─ polls the Host route every refreshSeconds
  │  unknown plus machine-readable reasons   └─ bilingual, lists every reason
  └─ serves it as JSON at /dsh-cold-backup/status
```

Parsing and health rules are pure functions covered by 28 `node --test` cases, runnable without a
live Harness:

```sh
npm test
```

## The JSON contract (`cold-backup.status/1`)

What `statusJsonCommand` reads is a **shared verdict**: the companion macOS panel (`Backup.app`) consumes
the very same document, so the two UIs cannot contradict each other.

| Field | Meaning |
|---|---|
| `schema` | The `cold-backup.status/` prefix; a document without it is never treated as ours |
| `verdict` | `ok` \| `bad` (mirrors that command's exit code) |
| `reasons[]` | `{code, target, message}`; `code` is a machine-readable identifier, `message` comes from the script (kept in Chinese — the script is the single source of truth shared with launchd, the docs and the self-test) |
| `targets[]` | One row per repo/snapshot/config: `state` (`ok`/`behind`/`missing`/`skipped`), `upload`, `at`, `bytes`, `sha256`, `dirty`, `message` |
| `counts` / `orphans` / `lastOk` / `lastFailure` | Counts, orphan directories, and the success/failure signals |

With it configured, **the script owns the verdict**: this plugin stops re-deriving the rules (two
implementations of one rule drifted apart once — the panel compared `>` where the plugin uses `>=`).
Without it, or when the output is not a valid document, the generic sources above are used; a configured
but unusable source is reported as a problem rather than silently ignored.

## Relationship to the backup scheme (`cold-backup`)

This plugin is the **UI front-end for a backup scheme, not the backup itself**. The scheme is: a
scheduled job writes its last success time to a file, appends failures to a log, and optionally runs
as a launchd job.

**Reading stays read-only, always.** **Writing is optional, since v2.0**: the panel can start a
backup / verify / daily run (on by default) plus two destructive actions (off by default). To keep
the plugin incapable of touching anything, turn `allowActions` off — it is then as read-only as 1.x
and just as safe to leave running.

### Security model for actions (v2.0)

- **Channels**: the read routes (`/status`, `/job`) stay open GETs; **actions are POST-only** on
  their own routes.
- **Trust predicate** (the same one `dsh-archived` uses, hardened against a real failure): loopback,
  `sec-fetch-site: same-origin` when present, `Origin` must match `Host` when present, and a request
  with no browser signals at all needs the marker header `x-dsh-cold-backup: 1` (that is the Desktop
  app's own pipeline). Cross-site is always refused — that is the CSRF case.
- **Commands are constants**: the body carries an action *id*, the id is looked up in a table, and
  the argv is run **without a shell**; the engine path is resolved by this package and **never comes
  from a request**. One action at a time (a second caller gets 409).
- **What it defends, and what it cannot**: it defends against a *web page* reaching `127.0.0.1` and
  against accidents. It does not — and cannot — defend against a local process of the same user:
  that process can run `cold-backup` itself. It also assumes Harness listens on loopback only;
  enable remote access and this model must be re-evaluated.
- `statusCommand` / `statusJsonCommand` are **operator-configured shell commands**; the action layer
  **never reuses** them and no request content ever builds a command line.

**The companion backup engine is [`cold-backup`](https://github.com/haotian-lu-prog/cold-backup)**
(a dependency-free bash CLI for macOS and Linux). Since v2.0 it is a **dependency of this package**,
so installing the plugin brings the engine; an empty `statusJsonCommand` is filled in with
`<engine> --status --json`:

```sh
cold-backup --init        # write a config; set ROOT and DEST (once)
cold-backup --status      # look manually; the panel shows the very same verdict
```

Priority is **your command > bundled dependency > PATH**, and the panel's *Engine* row tells you which
one answered. The other two routes still work exactly as before:

- `cold-backup` can still be installed **globally only** (`npm i -g cold-backup`) — the engine then
  comes from PATH and nothing else changes;
- it is **not required**: any scheme that writes `last-ok` / `last-failure`, or that can print a
  `cold-backup.status/1` document, works with this panel. The reverse is also true — `cold-backup`
  does not need this plugin; the plugin just brings the same verdict into the Harness UI.

> **About `statusCommand` / `statusJsonCommand`**: these are **operator-configured shell commands** —
  your machine, your choice. The plugin's action layer (v2.0 step 2) will **never reuse** them, and no
  request content ever builds a command line. See the security model in `docs/decisions.md`.

## License

MIT, see [LICENSE](LICENSE).
