English | [简体中文](https://github.com/haotian-lu-prog/dsh-dev-backup/blob/main/README.md)

# dsh-dev-backup

[![npm version](https://img.shields.io/npm/v/dsh-dev-backup)](https://www.npmjs.com/package/dsh-dev-backup)
[![license](https://img.shields.io/npm/l/dsh-dev-backup)](LICENSE)
[![Node](https://img.shields.io/node/v/dsh-dev-backup)](package.json)

A third-party DeepSeek Harness plugin that adds a **Backup** page to the Harness Web UI and answers
one question: *did my scheduled backup actually run, and when did it last succeed?*

It reads whatever a backup job leaves behind, so any scheme that can provide one of these works:

| Source | Meaning | How it is read |
|---|---|---|
| Freshness file | Time of the last **success** | Epoch seconds in the file; falls back to mtime when the content is not a bare number |
| Failure log | The most recent **problem** | Last line (the convention appends, so the last line is newest) |
| launchd job | Whether the timer is loaded, and its last exit code | `launchctl print gui/<uid>/<label>` |
| Status command (optional) | Any self-check | Exit code 0 is healthy; its output is shown in the panel |
| JSON status command (optional) | A structured status document | Runs a command (e.g. `backup-dev.sh --status --json`) and reads its `dev-backup.status/1` JSON; **when it parses, it wins**, and its per-target detail is shown |

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
- **No runtime dependencies** — the Host half uses node builtins only; the single dependency is
  `@deepseek-ai/schemastery`, used purely to declare Config.

## Requirements

- Node.js `^22.19` or `>=24`
- DeepSeek Harness **`0.2.0-rc.2`** (verified; see `docs/evidence/`)
- The `launchd` source is macOS-only; every other source is cross-platform

## Install

Install into a profile that serves the Web UI. The package carries no path dependency back to a
Harness checkout, and its `dsh.bundle` patch wires both the Host and Client plugin rows in:

```sh
dsh --profile web-backup --from-default-profile web --dump-config
dsh plugin --profile web-backup add dsh-dev-backup
dsh --profile web-backup
```

A locally built tarball works too:

```sh
npm pack
dsh plugin --profile web-backup add ./dsh-dev-backup-1.1.0.tgz
```

## Configuration

Everything lives under **Settings → Plugins → dsh-dev-backup**. All fields are `volatile()`, so edits
apply immediately without a restart:

| Field | Default | Meaning |
|---|---|---|
| `freshnessFile` | `~/Library/Logs/dev-backup/last-ok` | File holding the last success timestamp |
| `failureFile` | `~/Library/Logs/dev-backup/last-failure` | Failure log (empty disables it) |
| `launchdLabel` | empty | LaunchAgent label to inspect (empty disables it) |
| `statusCommand` | empty | Optional self-check; exit code 0 is healthy |
| `statusJsonCommand` | empty | Optional: a command printing a `dev-backup.status/1` document (e.g. `~/dev/_shared/bin/backup-dev.sh --status --json`). When it parses, its verdict drives the panel and its per-target detail is rendered |
| `staleAfterHours` | `36` | Older than this many hours is reported as stale |
| `refreshSeconds` | `30` | Panel polling interval |

The defaults describe the **dev-backup convention** (`last-ok` holds epoch seconds, `last-failure` is
appended to). Point the paths somewhere else to use it with any other backup scheme — the convention
itself is not required.

For example, if your backup is a launchd job named `com.example.nightly-backup` that writes its
success timestamp to `~/.backup/last-ok`, set `launchdLabel` to `com.example.nightly-backup` and
`freshnessFile` to `~/.backup/last-ok`.

## How it works

```
Host half (index.js)                       Client half (client.js)
  ├─ reads status files / launchctl / cmd    ├─ registers a "Backup" page on settings.section
  ├─ evaluateStatus() → ok/warn/bad/         ├─ polls the Host route every refreshSeconds
  │  unknown plus machine-readable reasons   └─ bilingual, lists every reason
  └─ serves it as JSON at /dsh-dev-backup/status
```

Parsing and health rules are pure functions covered by 26 `node --test` cases, runnable without a
live Harness:

```sh
npm test
```

## The JSON contract (`dev-backup.status/1`)

What `statusJsonCommand` reads is a **shared verdict**: the macOS panel (`~/dev/_shared/app`) consumes the
very same document, so the two UIs cannot contradict each other.

| Field | Meaning |
|---|---|
| `schema` | The `dev-backup.status/` prefix; a document without it is never treated as ours |
| `verdict` | `ok` \| `bad` (mirrors that command's exit code) |
| `reasons[]` | `{code, target, message}`; `code` is a machine-readable identifier, `message` comes from the script (kept in Chinese — the script is the single source of truth shared with launchd, the docs and the self-test) |
| `targets[]` | One row per repo/snapshot/config: `state` (`ok`/`behind`/`missing`/`skipped`), `upload`, `at`, `bytes`, `sha256`, `dirty`, `message` |
| `counts` / `orphans` / `lastOk` / `lastFailure` | Counts, orphan directories, and the success/failure signals |

With it configured, **the script owns the verdict**: this plugin stops re-deriving the rules (two
implementations of one rule drifted apart once — the panel compared `>` where the plugin uses `>=`).
Without it, or when the output is not a valid document, the generic sources above are used; a configured
but unusable source is reported as a problem rather than silently ignored.

## Relationship to the dev-backup convention

This plugin is the **UI front-end for a backup scheme, not the backup itself**. The scheme is: a
scheduled job writes its last success time to a file, appends failures to a log, and optionally runs
as a launchd job. The plugin only reads those artifacts — it never writes, triggers or deletes
anything, which is why it is safe to leave running.

## License

MIT, see [LICENSE](LICENSE).
