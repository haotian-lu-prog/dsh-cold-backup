// Action runner: start one engine run, follow its progress, cancel it, clean it up.
//
// Boundaries, all of them decided in `docs/decisions.md` §四–§六:
//   * **fixed argv per action** — nothing from a request ever reaches a command line. The body of
//     a POST carries an action *id*, and the id is looked up in the table below.
//   * **the engine path is resolved, never received** — the same resolver the status route uses.
//   * **single flight** — one job at a time; a second caller gets `busy`, not a queue.
//   * **destructive actions are refused** unless the operator enabled them (`allowDestructive`),
//     and the client is expected to confirm them again on top of that.
//   * **progress comes from the engine's own progress file** (`COLD_BACKUP_PROGRESS_FILE`), because
//     the log cannot produce honest progress: a measured 104 s `--daily` run wrote no counters and
//     no phase markers at all, only raw `git bundle verify` output. A bar derived from that would
//     sit at 0 % for forty seconds and then jump — worse than no bar.
//
// Everything external is injectable so `node --test` can drive the whole lifecycle without a real
// engine: no spawn, no timers of its own, no filesystem beyond the progress file.
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The whole action vocabulary. Adding an entry here is the only way to make a new command
 * reachable from a request — that is the point of the table.
 *
 * `sections` is what the progress bar should expect from that action (see `SECTION_WEIGHT`).
 */
export const ACTIONS = {
  backup: { argv: ['--trigger=ui'], sections: ['backup'], destructive: false },
  verify: { argv: ['--verify'], sections: ['verify'], destructive: false },
  daily: { argv: ['--daily', '--trigger=ui'], sections: ['backup', 'verify', 'status'], destructive: false },
  verifyFix: { argv: ['--verify', '--fix'], sections: ['verify'], destructive: true },
  prune: { argv: ['--prune-orphans', '--apply'], sections: [], destructive: true },
}

export const ACTION_IDS = Object.keys(ACTIONS)

/**
 * How much of the run each phase is worth, for the *overall* bar. These are estimates — the exact
 * counters per phase are shown next to the bar — but they are what makes the bar monotonic across
 * phases instead of restarting at 0 % when `--daily` moves from backup to verify.
 */
const SECTION_WEIGHT = { backup: 0.7, verify: 0.25, status: 0.05 }

/** Normalise the expected sections of one action into weights that sum to 1. */
export function sectionWeights(sections) {
  const wanted = Array.isArray(sections) ? sections.filter(name => name in SECTION_WEIGHT) : []
  if (wanted.length === 0) return {}
  const sum = wanted.reduce((total, name) => total + SECTION_WEIGHT[name], 0)
  const weights = {}
  for (const name of wanted) weights[name] = SECTION_WEIGHT[name] / sum
  return weights
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function unitKey(unit, fallback) {
  const kind = typeof unit?.kind === 'string' ? unit.kind : 'target'
  const label = typeof unit?.label === 'string' ? unit.label : String(fallback ?? '')
  return `${kind}:${label}`
}

/**
 * Turn the engine's progress events into one view for the panel.
 *
 * Pure. `events` is whatever the engine appended (malformed lines must already have been dropped by
 * `readProgressFile`), `sections` is the action's expectation.
 *
 * @returns {{ phase: string|null, current: string|null, percent: number|null,
 *             sections: Record<string, {done: number, total: number}>, finished: boolean,
 *             exitCode: number|null, engineMs: number|null }}
 */
export function summarizeProgress(events, options = {}) {
  const wanted = sectionWeights(options.sections)
  const plans = new Map()
  const doneUnits = new Map()
  let phase = null
  let current = null
  let verify = { done: 0, total: 0 }
  let finished = false
  let exitCode = null
  let engineMs = null
  let sawStatus = false

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.phase === 'plan' && typeof event.section === 'string') {
      const units = Array.isArray(event.units)
        ? event.units.map((unit, index) => ({ key: unitKey(unit, index), weight: positive(unit?.weight) }))
        : []
      plans.set(event.section, { total: count(event.total), units, done: 0 })
      if (!phase) phase = event.section
      continue
    }
    if (event.phase === 'backup') {
      phase = 'backup'
      if (event.state === 'start') {
        current = typeof event.label === 'string' ? event.label : null
      } else if (event.state === 'done') {
        const plan = plans.get('backup')
        const key = unitKey({ kind: event.kind, label: event.label })
        if (plan && !doneUnits.has(key)) {
          doneUnits.set(key, true)
          plan.done += 1
        }
        current = null
      }
      continue
    }
    if (event.phase === 'verify') {
      phase = 'verify'
      verify = { done: count(event.done), total: count(event.total) }
      if (typeof event.label === 'string') current = event.label
      continue
    }
    if (event.phase === 'status') {
      phase = 'status'
      sawStatus = true
      current = null
      continue
    }
    if (event.done === true) {
      finished = true
      exitCode = typeof event.exitCode === 'number' ? event.exitCode : null
      engineMs = typeof event.ms === 'number' ? event.ms : null
    }
  }

  const sections = {}
  for (const name of Object.keys(wanted)) {
    const plan = plans.get(name)
    if (name === 'verify') {
      sections.verify = { done: verify.done, total: verify.total }
    } else if (name === 'backup') {
      sections.backup = { done: plan?.done ?? 0, total: plan?.total ?? 0 }
    } else {
      sections[name] = { done: sawStatus ? 1 : 0, total: 1 }
    }
  }

  let percent = null
  if (finished) {
    percent = 100
  } else if (Object.keys(wanted).length > 0) {
    let acc = 0
    let known = false
    for (const [name, weight] of Object.entries(wanted)) {
      if (name === 'backup') {
        const plan = plans.get('backup')
        if (!plan) continue
        known = true
        const total = plan.units.reduce((sum, unit) => sum + unit.weight, 0)
        const done = plan.units.reduce((sum, unit) => (doneUnits.has(unit.key) ? sum + unit.weight : sum), 0)
        acc += weight * (total > 0 ? Math.min(1, done / total) : (plan.total > 0 ? Math.min(1, plan.done / plan.total) : 0))
      } else if (name === 'verify') {
        if (verify.total <= 0) continue
        known = true
        acc += weight * Math.min(1, verify.done / verify.total)
      } else if (name === 'status') {
        if (!sawStatus) continue
        known = true
        acc += weight
      }
    }
    if (known) percent = Math.round(Math.max(0, Math.min(1, acc)) * 100)
  }

  return { phase, current, percent, sections, finished, exitCode, engineMs }
}

/** Parse a progress file. A truncated final line (the engine may be mid-write) is simply skipped. */
export function parseProgress(text) {
  const events = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed)
    } catch {
      // Mid-write or foreign content: ignore that line, keep the rest.
    }
  }
  return events
}

/** Strip ANSI escapes so the panel never renders terminal colour codes. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

/**
 * One job at a time, with an injectable clock and spawn so tests need no real process.
 *
 * @param {object} options
 * @param {() => {path: string|null}} options.resolveEngine
 * @param {string} options.progressDir directory the per-job progress file lives in
 * @param {(file: string, args: string[], options: object) => object} [options.spawn]
 * @param {() => number} [options.now]
 * @param {number} [options.maxTailBytes]
 */
export function createJobRunner(options = {}) {
  const spawnImpl = options.spawn ?? nodeSpawn
  const now = options.now ?? Date.now
  const resolveEngine = options.resolveEngine ?? (() => ({ path: null }))
  const progressDir = options.progressDir
  const maxTailBytes = options.maxTailBytes ?? 64 * 1024
  const readFileImpl = options.readFile ?? readFile
  const mkdirImpl = options.mkdir ?? mkdir
  const rmImpl = options.rm ?? rm

  let job = null
  let sequence = 0

  function tail(previous, chunk) {
    const next = previous + chunk
    return next.length > maxTailBytes ? next.slice(next.length - maxTailBytes) : next
  }

  async function progressEvents(current) {
    if (!current?.progressPath) return []
    try {
      return parseProgress(await readFileImpl(current.progressPath, 'utf8'))
    } catch {
      return []
    }
  }

  function view(current, events) {
    const summary = summarizeProgress(events, { sections: ACTIONS[current.action]?.sections ?? [] })
    return {
      // What the engine reported through its progress file (may be absent on older engines).
      phase: summary.phase,
      current: summary.current,
      percent: summary.percent,
      sections: summary.sections,
      engineFinished: summary.finished,
      engineExitCode: summary.exitCode,
      engineMs: summary.engineMs,
      // What this process actually knows. Deliberately *after* the summary: the child's exit code
      // is the authority on how the run ended, and must never be overwritten by a document the
      // engine may not even have written.
      id: current.id,
      action: current.action,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt ?? null,
      running: current.child !== null,
      exitCode: current.child === null ? current.exitCode : null,
      error: current.error ?? null,
      elapsedMs: (current.finishedAt ?? now()) - current.startedAt,
      outputTail: stripAnsi(current.output).trim().split('\n').slice(-40).join('\n'),
    }
  }

  return {
    /** Start one action. Returns `{ job }` or `{ error, ... }` — never throws for user input. */
    async start(actionId, { allowDestructive = false } = {}) {
      const action = ACTIONS[actionId]
      if (!action) return { error: 'unknown-action', allowed: ACTION_IDS }
      if (job && job.child !== null) return { error: 'busy', running: view(job, []).action }
      if (action.destructive && !allowDestructive) return { error: 'destructive-disabled' }

      const engine = resolveEngine() ?? {}
      if (!engine.path) return { error: 'engine-missing', reason: engine.reason ?? null }

      // One job exists at a time, so the previous job's progress file is dead weight: drop it now.
      // `dispose()` also removes the last one, but a hard kill (or a host that never unmounts)
      // would otherwise leave a file per run behind — the directory has to stay bounded.
      if (job?.progressPath) {
        try {
          await rmImpl(job.progressPath, { force: true })
        } catch {
          // Best effort: a stale file is harmless, an unbounded directory is not.
        }
      }

      const id = `job-${now().toString(36)}-${(sequence += 1)}`
      const dir = typeof progressDir === 'function' ? progressDir() : progressDir
      const progressPath = dir ? join(dir, `${id}.jsonl`) : null
      if (progressPath) {
        try {
          await mkdirImpl(dir, { recursive: true })
          await rmImpl(progressPath, { force: true })
        } catch {
          // A progress file we cannot prepare must not stop the run: the action still works, the
          // panel just shows an indeterminate bar for it.
        }
      }

      const env = { ...process.env }
      if (progressPath) env.COLD_BACKUP_PROGRESS_FILE = progressPath

      let child = null
      try {
        child = spawnImpl('/bin/bash', [engine.path, ...action.argv], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        return { error: 'spawn-failed', detail: String(error?.message ?? error) }
      }

      job = {
        id,
        action: actionId,
        startedAt: now(),
        finishedAt: null,
        exitCode: null,
        error: null,
        progressPath,
        child,
        output: '',
      }
      const current = job

      const absorb = chunk => {
        if (current !== job) return
        current.output = tail(current.output, String(chunk))
      }
      child.stdout?.on?.('data', absorb)
      child.stderr?.on?.('data', absorb)
      child.on?.('error', error => {
        current.error = String(error?.message ?? error)
      })
      child.on?.('close', code => {
        current.child = null
        current.exitCode = typeof code === 'number' ? code : null
        current.finishedAt = now()
      })

      return { job: view(current, []) }
    },

    /** Current (or last) job, with the progress the engine has written so far. */
    async status() {
      if (!job) return null
      return view(job, await progressEvents(job))
    },

    /** SIGTERM the running job. The engine releases its lock from its EXIT trap (measured). */
    cancel() {
      if (!job || job.child === null) return false
      try {
        job.child.kill('SIGTERM')
      } catch {
        return false
      }
      return true
    },

    /** Kill any running child and drop the last progress file. Called from `ctx.effect` cleanup. */
    async dispose() {
      if (job?.child) {
        try {
          job.child.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }
      if (job?.progressPath) {
        try {
          await rmImpl(job.progressPath, { force: true })
        } catch {
          // Bounded by the log directory; leaving one file behind is not worth failing shutdown.
        }
      }
      job = null
    },
  }
}
