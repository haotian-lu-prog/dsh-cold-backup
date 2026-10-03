// dsh-cold-backup — Host half.
//
// Answers one question, from inside the Harness: *did my scheduled backup actually run,
// and when?* The answer is served as JSON on a private route that the Client half polls.
//
// Two kinds of answer:
//   1. Generic sources — a last-success timestamp file, a failure log, a launchd job, a status
//      command. Works with any backup scheme, and stays read-only.
//   2. `statusJsonCommand` — a command that prints a `cold-backup.status/1` document
//      (`cold-backup --status --json` does). When it parses, **its verdict is authoritative**
//      and the panel renders its per-target detail. This is the very same document the macOS
//      panel consumes, so the two UIs cannot drift apart — they did before, once: the panel
//      compared `>` where we compare `>=`, and silently hid the case we report.
//
// Everything here is deliberately dependency-free (node builtins only) and split into pure
// functions so `node --test` can cover the parsing and the health rules without a live Harness.
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import z from '@deepseek-ai/schemastery'

import { ACTION_IDS, createJobRunner } from './actions.js'
import { resolveEngine } from './engine.js'
import { refusalReasons, trustReport } from './trust.js'

export const name = 'dsh-cold-backup'
export const inject = ['webServer']

/** Profile entry id from `cordis.patch.yml`; it names this plugin's settings form. */
export const ENTRY_ID = 'dsh-cold-backup'

/** Route the Client half polls. Distinct from any shipped route. */
export const STATUS_PATH = '/dsh-cold-backup/status'
/** Action routes (v2.0). POST only, and guarded by `trust.js`; the read routes above stay open. */
export const ACTION_PATH = '/dsh-cold-backup/action'
export const CANCEL_PATH = '/dsh-cold-backup/cancel'
export const JOB_PATH = '/dsh-cold-backup/job'

const execFileAsync = promisify(execFile)

/**
 * The cold-backup convention: a backup run writes the epoch seconds of its last success to
 * `last-ok`, and appends failures to `last-failure`. Anything else can be pointed at these
 * paths instead — the plugin only cares that `last-ok` holds a timestamp.
 *
 * The reference implementation is the `cold-backup` CLI (npm: `cold-backup`, macOS + Linux), and
 * these two defaults are exactly its defaults on macOS — so the common setup needs no config.
 * Any other scheme writing the same two files works just as well.
 */
export const DEFAULT_FRESHNESS_FILE = '~/Library/Logs/cold-backup/last-ok'
export const DEFAULT_FAILURE_FILE = '~/Library/Logs/cold-backup/last-failure'

export const Config = z.object({
  // `volatile()` keeps the field editable without remounting the plugin: the value reference is
  // updated in place. `readField` below still accepts a plain value, because a Loader that does
  // not hand out references would otherwise break every read.
  freshnessFile: z.string().default(DEFAULT_FRESHNESS_FILE).volatile()
    .description('File whose contents (epoch seconds) or mtime is the last successful backup.'),
  failureFile: z.string().default(DEFAULT_FAILURE_FILE).volatile()
    .description('File whose last line describes the most recent failed run. Empty to disable.'),
  launchdLabel: z.string().default('').volatile()
    .description('macOS LaunchAgent label to inspect for its state and last exit code. Empty to disable.'),
  statusCommand: z.string().default('').volatile()
    .description('Optional command; exit code 0 means healthy. Its output is shown in the panel.'),
  statusJsonCommand: z.string().default('').volatile()
    .description('Optional command printing a cold-backup.status/1 JSON document, e.g. '
      + '"cold-backup --status --json" (npm i -g cold-backup). When it parses, its verdict drives the '
      + 'panel and its per-target detail is shown. Empty to disable. Takes priority over the bundled '
      + 'engine below; operator config is never reused by anything that writes.'),
  bundledEngine: z.boolean().default(true).volatile()
    .description('Use the cold-backup engine this package depends on (v2.0+), with a fallback to '
      + '`cold-backup` on PATH. Turn off to keep the plugin strictly passive: it then reads only the '
      + 'file / launchd sources below and starts no process at all.'),
  allowActions: z.boolean().default(true).volatile()
    .description('Allow the panel to start engine runs (backup / verify / daily). Turn off to keep '
      + 'this plugin strictly read-only: the action routes then refuse everything with 403.'),
  allowDestructive: z.boolean().default(false).volatile()
    .description('Also allow the two destructive actions (verify --fix, prune-orphans --apply). Off '
      + 'by default: they delete artifacts, and the panel asks for a second confirmation on top.'),
  staleAfterHours: z.natural().default(36).volatile()
    .description('A last success older than this many hours is reported as stale.'),
  refreshSeconds: z.natural().min(5).max(3600).default(30).volatile()
    .description('How often the panel re-reads the status.'),
})

/** Expand a leading `~` so config stays readable in the settings UI. */
export function expandHome(input, home = homedir()) {
  if (typeof input !== 'string' || input.length === 0) return ''
  if (input === '~') return home
  if (input.startsWith('~/')) return join(home, input.slice(2))
  return input
}

/**
 * `last-ok` holds epoch seconds in the cold-backup convention, but a plain freshness file may
 * hold anything. Accept a bare number, otherwise fall back to the file's mtime.
 */
export function readTimestamp(raw, mtimeMs) {
  const text = String(raw ?? '').trim()
  if (text.length > 0 && /^\d{9,13}$/.test(text)) {
    const value = Number(text)
    // 10 digits ≈ seconds, 13 ≈ milliseconds. Both are unambiguous at these magnitudes.
    return text.length >= 12 ? value : value * 1000
  }
  return typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? mtimeMs : null
}

/** Parse `launchctl print gui/<uid>/<label>`. Pure so the exact output shape is testable. */
export function parseLaunchctlPrint(text) {
  const result = { loaded: false, state: null, lastExitCode: null, runs: null }
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('state = ')) {
      result.state = trimmed.slice('state = '.length)
      result.loaded = true
    } else if (trimmed.startsWith('last exit code = ')) {
      const value = Number.parseInt(trimmed.slice('last exit code = '.length), 10)
      if (Number.isFinite(value)) result.lastExitCode = value
    } else if (trimmed.startsWith('runs = ')) {
      const value = Number.parseInt(trimmed.slice('runs = '.length), 10)
      if (Number.isFinite(value)) result.runs = value
    }
  }
  return result
}

/** Last non-empty line of the failure log; the cold-backup convention appends, so this is newest. */
export function readLastFailureLine(raw) {
  const lines = String(raw ?? '').split('\n').filter(line => line.trim().length > 0)
  if (lines.length === 0) return null
  const last = lines[lines.length - 1]
  const parts = last.split('\t')
  const epoch = Number.parseInt(String(parts[0] ?? '').replace('epoch=', ''), 10)
  const message = parts.length >= 3 ? parts.slice(2).join('\t') : last
  return {
    at: Number.isFinite(epoch) ? epoch * 1000 : null,
    message: message.trim(),
  }
}

/** Schema prefix of the JSON contract shared with the macOS panel (and any other consumer). */
export const STATUS_JSON_SCHEMA_PREFIX = 'cold-backup.status/'

function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Parse the `cold-backup.status/1` contract. Returns null for anything we do not recognise:
 * a foreign, newer or malformed document must never be rendered as if it were ours (the panel
 * falls back to the generic sources instead, and says so).
 *
 * Everything is validated field by field. The point of consuming the document is that the script
 * already applied the rules — re-deriving them here is exactly how the two implementations of
 * one rule drifted apart before.
 */
export function parseStatusJson(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  let document
  try {
    document = JSON.parse(raw)
  } catch {
    return null
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return null
  const schema = stringOr(document.schema, '')
  if (!schema.startsWith(STATUS_JSON_SCHEMA_PREFIX)) return null
  // Only the two verdicts the contract defines; anything else means a document we do not know.
  if (document.verdict !== 'ok' && document.verdict !== 'bad') return null

  const targets = Array.isArray(document.targets)
    ? document.targets
      .filter(entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      .map(entry => ({
        kind: stringOr(entry.kind, 'unknown'),
        label: stringOr(entry.label, '?'),
        state: stringOr(entry.state, 'unknown'),
        artifact: stringOr(entry.artifact, null),
        at: numberOr(entry.at, null),
        bytes: numberOr(entry.bytes, null),
        sha256: stringOr(entry.sha256, null),
        upload: stringOr(entry.upload, null),
        dirty: numberOr(entry.dirty, null),
        message: stringOr(entry.message, ''),
      }))
    : []

  const reasons = Array.isArray(document.reasons)
    ? document.reasons
      .filter(entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      .map(entry => ({
        // `engine:` keeps the script's vocabulary apart from ours — the two sets will grow
        // independently, and a collision would silently mislabel a reason.
        code: `engine:${stringOr(entry.code, 'unknown')}`,
        target: stringOr(entry.target, null),
        message: stringOr(entry.message, ''),
      }))
    : []

  const counts = document.counts !== null && typeof document.counts === 'object'
    ? {
        repos: numberOr(document.counts.repos, 0),
        snapshots: numberOr(document.counts.snapshots, 0),
        configs: numberOr(document.counts.configs, 0),
        problems: numberOr(document.counts.problems, 0),
        orphans: numberOr(document.counts.orphans, 0),
      }
    : null

  return {
    schema,
    verdict: document.verdict,
    dest: stringOr(document.dest, null),
    generatedAt: numberOr(document.generatedAt, null),
    lastOk: numberOr(document.lastOk, null),
    lastFailure: document.lastFailure !== null && typeof document.lastFailure === 'object'
      ? {
          epoch: numberOr(document.lastFailure.epoch, null),
          trigger: stringOr(document.lastFailure.trigger, null),
          message: stringOr(document.lastFailure.message, ''),
        }
      : null,
    orphans: Array.isArray(document.orphans) ? document.orphans.filter(item => typeof item === 'string') : [],
    targets,
    reasons,
    counts,
  }
}

/**
 * The health rules, in one place so the panel can explain *why* it is red.
 * Returns `ok` | `warn` | `bad` | `unknown` plus machine-readable reasons.
 */
export function evaluateStatus(input, options = {}) {
  const staleAfterHours = Number.isFinite(options.staleAfterHours) ? options.staleAfterHours : 36
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const reasons = []

  const freshness = input.freshness ?? null
  const launchd = input.launchd ?? null
  const failure = input.failure ?? null

  // 1. A parsed cold-backup.status/1 document wins outright: the script already applied every rule,
  //    and the macOS panel shows that same document. Re-deriving the rules here is how the two
  //    implementations drifted apart before (the panel compared `>` where we compare `>=`).
  const document = input.document ?? null
  if (document) {
    return {
      level: document.verdict === 'ok' ? 'ok' : 'bad',
      reasons: document.reasons,
      ageHours: null,
      source: 'engine',
    }
  }

  // 2. Configured but unusable: say so instead of quietly falling back to a source the user did
  //    not point us at. "Broken" and "not configured" must never look the same.
  if (input.engineFailed) {
    return { level: 'bad', reasons: [{ code: 'status-json-failed' }], ageHours: null, source: 'engine' }
  }

  const configured = Boolean(freshness || launchd || input.command)
  if (!configured) {
    return { level: 'unknown', reasons: [{ code: 'unconfigured' }], ageHours: null }
  }

  // Nothing has been recorded yet AND the engine that would record it is missing: name the actual
  // fix instead of leaving the panel at a bare "no successful backup yet".
  if (input.engineMissing && freshness && freshness.missing && !launchd && !input.command) {
    reasons.push({ code: 'engine-missing' })
  }

  if (freshness && freshness.missing) {
    reasons.push({ code: 'freshness-missing', path: freshness.path })
  }

  let ageHours = null
  if (freshness && Number.isFinite(freshness.at)) {
    ageHours = (now - freshness.at) / 3_600_000
    if (ageHours > staleAfterHours) {
      reasons.push({ code: 'stale', ageHours, staleAfterHours })
    }
  } else if (freshness && !freshness.missing) {
    reasons.push({ code: 'freshness-unreadable', path: freshness.path })
  }

  if (launchd) {
    if (!launchd.loaded) reasons.push({ code: 'launchd-not-loaded' })
    else if (launchd.lastExitCode !== null && launchd.lastExitCode !== 0) {
      reasons.push({ code: 'launchd-failed', lastExitCode: launchd.lastExitCode })
    }
  }

  // A failure that the last success does not supersede is the strongest signal there is.
  // Note `>=`, not `>`: the cold-backup convention treats the mere presence of a `last-failure`
  // record as "the last run had a problem", and a single run can both record one and write
  // `last-ok` within the same second. Using `>` would silently hide exactly that case.
  if (failure && Number.isFinite(failure.at)) {
    const lastSuccess = freshness && Number.isFinite(freshness.at) ? freshness.at : null
    if (lastSuccess === null || failure.at >= lastSuccess) {
      reasons.push({ code: 'failure-not-superseded', at: failure.at })
    }
  }

  if (input.command && Number.isFinite(input.command.exitCode) && input.command.exitCode !== 0) {
    reasons.push({ code: 'command-failed', exitCode: input.command.exitCode })
  }

  const bad = reasons.some(r => r.code === 'freshness-missing'
    || r.code === 'launchd-not-loaded'
    || r.code === 'launchd-failed'
    || r.code === 'failure-not-superseded'
    || r.code === 'command-failed'
    || r.code === 'freshness-unreadable')
  const level = bad ? 'bad' : (reasons.length > 0 ? 'warn' : 'ok')
  return { level, reasons, ageHours }
}

async function readFreshnessFile(path) {
  if (!path) return null
  try {
    const [raw, info] = await Promise.all([
      readFile(path, 'utf8').catch(() => null),
      stat(path).catch(() => null),
    ])
    if (info === null && raw === null) return { path, missing: true, at: null }
    return { path, missing: false, at: readTimestamp(raw, info?.mtimeMs) }
  } catch {
    return { path, missing: true, at: null }
  }
}

async function readFailureFile(path) {
  if (!path) return null
  const raw = await readFile(path, 'utf8').catch(() => null)
  return raw === null ? null : readLastFailureLine(raw)
}

async function readLaunchd(label) {
  if (!label) return null
  if (process.platform !== 'darwin') return { label, loaded: false, unsupported: true, state: null, lastExitCode: null, runs: null }
  try {
    const { stdout } = await execFileAsync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { timeout: 5_000 })
    return { label, ...parseLaunchctlPrint(stdout) }
  } catch (error) {
    // launchctl exits non-zero for an unloaded label; either way it is "not loaded".
    return { label, ...parseLaunchctlPrint(String(error?.stdout ?? '')), loaded: false }
  }
}

async function runStatusCommand(command) {
  if (!command) return null
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], { timeout: 60_000, maxBuffer: 1 << 20 })
    return { exitCode: 0, output: String(stdout || stderr).trim() }
  } catch (error) {
    return {
      exitCode: Number.isFinite(error?.code) ? error.code : 1,
      output: String(error?.stdout || error?.stderr || error?.message || '').trim(),
    }
  }
}

/**
 * Same shape as `runStatusCommand`, but **stdout is kept even when the command exits non-zero**:
 * `--status --json` prints a perfectly good document *together with* exit code 1 when the backup
 * has a problem. Dropping stdout on failure would turn every real problem into "could not read
 * the status", which is the opposite of useful.
 */
async function runJsonStatusCommand(command) {
  if (!command) return null
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], { timeout: 60_000, maxBuffer: 4 << 20 })
    return { exitCode: 0, output: String(stdout || stderr) }
  } catch (error) {
    return {
      exitCode: Number.isFinite(error?.code) ? error.code : 1,
      output: String(error?.stdout || error?.stderr || ''),
      error: String(error?.message ?? error),
    }
  }
}

/**
 * Run a resolved engine with a **fixed argv** — `/bin/bash <engine> --status --json`. No shell is
 * involved and no part of the argv comes from a request, so there is nothing to quote or escape.
 * Like `runJsonStatusCommand`, stdout is kept even on a non-zero exit: a healthy document and
 * exit code 1 arrive together whenever the backup itself has a problem.
 */
async function runEngineJson(argv) {
  if (!Array.isArray(argv) || argv.length < 2) return null
  try {
    const { stdout, stderr } = await execFileAsync('/bin/bash', argv, { timeout: 60_000, maxBuffer: 4 << 20 })
    return { exitCode: 0, output: String(stdout || stderr) }
  } catch (error) {
    return {
      exitCode: Number.isFinite(error?.code) ? error.code : 1,
      output: String(error?.stdout || error?.stderr || ''),
      error: String(error?.message ?? error),
    }
  }
}

/** Collect one snapshot. `deps` is injectable so tests never touch the real machine. */
export async function collectStatus(config, deps = {}) {
  const read = {
    freshness: deps.readFreshnessFile ?? readFreshnessFile,
    failure: deps.readFailureFile ?? readFailureFile,
    launchd: deps.readLaunchd ?? readLaunchd,
    command: deps.runStatusCommand ?? runStatusCommand,
    jsonCommand: deps.runJsonStatusCommand ?? runJsonStatusCommand,
    engineJson: deps.runEngineJson ?? runEngineJson,
  }
  const home = deps.home ?? homedir()
  const freshnessPath = expandHome(config.freshnessFile, home)
  const failurePath = expandHome(config.failureFile, home)

  // Where does the engine come from? (v2.0: this package depends on `cold-backup`, so the common
  // install needs no global CLI; a machine that only has the global CLI keeps working.) The path
  // is resolved here and never derived from a request — the only inputs are this package's own
  // module resolution and PATH.
  const bundledEngine = config.bundledEngine !== false
  const engineInfo = bundledEngine
    ? (deps.resolveEngine ?? resolveEngine)(deps.engineOptions)
    : { path: null, source: null, version: null, reason: 'disabled' }
  const explicitJsonCommand = typeof config.statusJsonCommand === 'string' ? config.statusJsonCommand.trim() : ''
  // Priority: operator config > bundled dependency > PATH (resolved above in that order).
  const enginePlan = explicitJsonCommand
    ? { mode: 'config', source: 'config', path: null, version: null, command: explicitJsonCommand, argv: null }
    : engineInfo.path
      ? { mode: 'engine', source: engineInfo.source, path: engineInfo.path, version: engineInfo.version, command: null,
          argv: [engineInfo.path, '--status', '--json'] }
      : { mode: 'none', source: null, path: null, version: engineInfo.version ?? null, command: null, argv: null }

  const [freshness, failure, launchd, command, engineRun] = await Promise.all([
    read.freshness(freshnessPath),
    read.failure(failurePath),
    read.launchd(config.launchdLabel),
    read.command(config.statusCommand),
    enginePlan.mode === 'config' ? read.jsonCommand(enginePlan.command)
      : enginePlan.mode === 'engine' ? read.engineJson(enginePlan.argv)
        : null,
  ])

  // The JSON contract, shared with the macOS panel. `document` is null when no source ran, when the
  // command printed nothing usable, or when the document is not ours — those cases are told apart
  // below, because "not configured" must never look like "broken".
  const engine = enginePlan.mode === 'none'
    ? null
    : {
        configured: true,
        source: enginePlan.source,
        path: enginePlan.path,
        version: enginePlan.version,
        exitCode: engineRun === null ? null : engineRun.exitCode,
        document: parseStatusJson(engineRun?.output ?? ''),
        output: null,
      }
  if (engine !== null && engine.document === null) {
    engine.output = String(engineRun?.output ?? engineRun?.error ?? '').trim().slice(0, 1000)
  }

  const evaluated = evaluateStatus({
    freshness,
    failure,
    launchd,
    command,
    document: engine?.document ?? null,
    engineFailed: Boolean(engine && engine.document === null),
    // The engine was *expected* (the bundled dependency or something on PATH) but is nowhere to
    // be found: worth a reason of its own, because "install the engine" and "no backup has run
    // yet" need different fixes. Only reported when it is the reason the panel is empty.
    engineMissing: enginePlan.mode === 'none' && bundledEngine,
  }, {
    staleAfterHours: config.staleAfterHours,
    now: deps.now,
  })

  // Did the user actually point this plugin at anything, or is it still on the shipped default?
  // A brand-new install whose default file happens not to exist is "not set up yet", not "your
  // backup is broken" — the panel has to tell those apart to say anything useful on the first run.
  // Health is deliberately unaffected; this only drives the hint.
  const explicitlyConfigured = Boolean(config.launchdLabel)
    || Boolean(config.statusCommand)
    || Boolean(config.statusJsonCommand)
    || (config.freshnessFile ?? DEFAULT_FRESHNESS_FILE) !== DEFAULT_FRESHNESS_FILE
    || (config.failureFile ?? DEFAULT_FAILURE_FILE) !== DEFAULT_FAILURE_FILE

  return {
    generatedAt: Date.now(),
    level: evaluated.level,
    reasons: evaluated.reasons,
    ageHours: evaluated.ageHours,
    explicitlyConfigured,
    // Which engine produced the document (null when none ran), and where it came from. Kept
    // top-level and flat: it is what the acceptance test and the panel both check.
    engineSource: engine?.source ?? null,
    engineVersion: enginePlan.version ?? null,
    enginePath: enginePlan.path ?? null,
    engineMissing: enginePlan.mode === 'none' && bundledEngine,
    freshness,
    failure,
    launchd,
    command,
    engine,
    config: {
      freshnessFile: freshnessPath,
      failureFile: failurePath,
      launchdLabel: config.launchdLabel,
      statusCommand: config.statusCommand,
      statusJsonCommand: config.statusJsonCommand,
      bundledEngine,
      allowActions: config.allowActions !== false,
      allowDestructive: config.allowDestructive === true,
      staleAfterHours: config.staleAfterHours,
      refreshSeconds: config.refreshSeconds,
    },
  }
}

/** Read one config field whether the Loader handed us a live reference or a plain value. */
export function readField(field, fallback) {
  if (field && typeof field.get === 'function') return field.get()
  if (field === undefined || field === null) return fallback
  return field
}

function readConfig(config) {
  return {
    freshnessFile: readField(config.freshnessFile, DEFAULT_FRESHNESS_FILE),
    failureFile: readField(config.failureFile, DEFAULT_FAILURE_FILE),
    launchdLabel: readField(config.launchdLabel, ''),
    statusCommand: readField(config.statusCommand, ''),
    statusJsonCommand: readField(config.statusJsonCommand, ''),
    bundledEngine: readField(config.bundledEngine, true),
    allowActions: readField(config.allowActions, true) !== false,
    allowDestructive: readField(config.allowDestructive, false) === true,
    staleAfterHours: readField(config.staleAfterHours, 36),
    refreshSeconds: readField(config.refreshSeconds, 30),
  }
}

/**
 * Where per-job progress files go: next to the engine's own status files, so a custom log directory
 * is honoured. `null` when there is nothing to derive it from — the runner then runs without a
 * progress file and the panel shows an indeterminate bar instead of a made-up percentage.
 */
export function progressDirectory(config) {
  const freshness = expandHome(readField(config?.freshnessFile, DEFAULT_FRESHNESS_FILE))
  return freshness ? join(dirname(freshness), 'progress') : null
}

/** Read a small JSON body. Capped: an action request carries an id and nothing else. */
async function readJsonBody(request, limit = 4096) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Mount the read routes and (v2.0) the action routes for this Harness process.
 *
 * `/status` and `/job` stay open on purpose — read-only, polled by the panel, and revealing nothing
 * a local process could not read itself. Everything that starts or stops work is a **POST behind
 * `trust.js`**; the security model and the threat it does (and does not) cover are in
 * `docs/decisions.md`.
 */
export function apply(ctx, config) {
  // Config stays on the generated form (the schema carries descriptions), so the Client half
  // is purely the live status panel — the two never show the same fields twice.
  ctx.effect(() => {
    const runner = createJobRunner({
      resolveEngine: () => resolveEngine(),
      progressDir: () => progressDirectory(readConfig(config)),
    })

    const sendJson = (res, statusCode, body) => {
      res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    }

    const disposers = []

    // ── read: the status snapshot ────────────────────────────────────────────────────────────
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method-not-allowed' })
          return
        }
        let body
        try {
          body = await collectStatus(readConfig(config))
        } catch (error) {
          // Say *why* in the payload as well as the log: a bare "collection-failed" is
          // undebuggable from the browser, where the user actually sees it.
          const detail = String(error?.message ?? error)
          ctx.logger.warn(`dsh-cold-backup: status collection failed: ${detail}`)
          sendJson(res, 500, { error: 'collection-failed', detail })
          return
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body))
      },
    }))

    // ── read: the running (or last) job, including the engine's own progress ─────────────────
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: JOB_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method-not-allowed' })
          return
        }
        let job = null
        try {
          job = await runner.status()
        } catch (error) {
          ctx.logger.warn(`dsh-cold-backup: job status failed: ${String(error?.message ?? error)}`)
        }
        sendJson(res, 200, { job })
      },
    }))

    // ── write: start one action ──────────────────────────────────────────────────────────────
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: ACTION_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method-not-allowed', allow: 'POST' })
          return
        }
        const report = trustReport(req)
        if (!report.trusted) {
          // Refuse with the evidence: this is exactly the failure that was invisible for a whole
          // round in the plugin this model was copied from.
          sendJson(res, 403, { error: 'untrusted-request', reasons: refusalReasons(report) })
          return
        }
        const settings = readConfig(config)
        if (settings.allowActions !== true) {
          sendJson(res, 403, { error: 'actions-disabled' })
          return
        }
        const body = await readJsonBody(req)
        if (body === null || typeof body.action !== 'string') {
          sendJson(res, 400, { error: 'invalid-body', allowed: ACTION_IDS })
          return
        }
        const result = await runner.start(body.action, {
          allowDestructive: settings.allowDestructive === true,
        })
        if (result?.error) {
          const statusCode = result.error === 'busy' ? 409
            : result.error === 'unknown-action' ? 400
              : result.error === 'engine-missing' ? 503
                : 403
          sendJson(res, statusCode, result)
          return
        }
        ctx.logger.info?.(`dsh-cold-backup: started ${body.action} as ${result.job?.id ?? '?'}`)
        sendJson(res, 202, result)
      },
    }))

    // ── write: cancel the running job ────────────────────────────────────────────────────────
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: CANCEL_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method-not-allowed', allow: 'POST' })
          return
        }
        const report = trustReport(req)
        if (!report.trusted) {
          sendJson(res, 403, { error: 'untrusted-request', reasons: refusalReasons(report) })
          return
        }
        const cancelled = runner.cancel()
        sendJson(res, cancelled ? 200 : 409, { cancelled })
      },
    }))

    return () => {
      // A Harness shutdown must not leave a backup holding the engine lock: SIGTERM runs the
      // engine's EXIT trap, which releases it (measured — 0 s, exit code 143).
      void runner.dispose()
      for (const dispose of disposers) dispose()
    }
  })
}
