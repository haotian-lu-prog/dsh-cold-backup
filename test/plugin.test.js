// Tests for dsh-cold-backup. `node --test`, no live Harness required: the Host half is written
// as pure functions plus one injectable collector, so every rule is covered here.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { ACTIONS, ACTION_IDS, createJobRunner, parseProgress, sectionWeights, stripAnsi, summarizeProgress } from '../actions.js'
import { resolveEngine } from '../engine.js'
import { MARKER_HEADER, isTrustedRequest, refusalReasons, trustReport } from '../trust.js'
import {
  ACTION_PATH,
  CANCEL_PATH,
  DEFAULT_FAILURE_FILE,
  DEFAULT_FRESHNESS_FILE,
  ENTRY_ID,
  JOB_PATH,
  STATUS_PATH,
  apply,
  collectStatus,
  evaluateStatus,
  expandHome,
  name,
  parseLaunchctlPrint,
  parseStatusJson,
  readLastFailureLine,
  readTimestamp,
} from '../index.js'

/** A document shaped exactly like `cold-backup --status --json` (contract cold-backup.status/1). */
const STATUS_DOCUMENT = {
  schema: 'cold-backup.status/1',
  generatedAt: 1_790_932_000,
  root: '/Users/x/dev',
  dest: '/Users/x/OneDrive/cold-backup',
  verdict: 'bad',
  lastOk: 1_790_931_285,
  lastFailure: { epoch: 1_790_931_285, trigger: 'daily', message: '有目标被跳过' },
  orphans: ['repos/gone'],
  reasons: [{ code: 'behind', target: 'demo', message: '备份落后（HEAD abc，最新 bundle demo-1.bundle）' }],
  targets: [
    {
      kind: 'repo', label: 'demo', state: 'behind', artifact: 'demo-1.bundle', at: 1_790_930_000,
      bytes: 1234, sha256: 'a'.repeat(64), upload: 'uploaded', dirty: 3, message: '备份落后',
    },
    {
      kind: 'snapshot', label: 'scratch', state: 'ok', artifact: 'scratch-1.tar.gz', at: 1_790_930_000,
      bytes: 42, sha256: null, upload: 'unknown-cloud', dirty: null, message: 'scratch-1.tar.gz（0 天前）',
    },
  ],
  counts: { repos: 1, snapshots: 1, configs: 0, problems: 1, orphans: 1 },
}
const STATUS_JSON = JSON.stringify(STATUS_DOCUMENT)
const IDLE_READERS = {
  readFreshnessFile: async () => null,
  readFailureFile: async () => null,
  readLaunchd: async () => null,
  runStatusCommand: async () => null,
  // v2.0: the collector resolves an engine by default (dependency → PATH). Tests must never let
  // that reach the real machine — this suite only ever touches mktemp fixtures — so the base
  // readers pin "no engine installed" and the engine cases below opt in explicitly.
  resolveEngine: () => ({ path: null, source: null, version: null, reason: 'missing-dependency' }),
}

const root = fileURLToPath(new URL('..', import.meta.url))
const HOUR = 3_600_000

test('expandHome only rewrites a leading tilde', () => {
  assert.equal(expandHome('~/x', '/home/u'), '/home/u/x')
  assert.equal(expandHome('~', '/home/u'), '/home/u')
  assert.equal(expandHome('/abs/~/x', '/home/u'), '/abs/~/x')
  assert.equal(expandHome('', '/home/u'), '')
  assert.equal(expandHome(undefined, '/home/u'), '')
})

test('readTimestamp accepts epoch seconds, milliseconds, and falls back to mtime', () => {
  assert.equal(readTimestamp('1790095112\n', 1), 1_790_095_112_000)
  assert.equal(readTimestamp('1790095112000', 1), 1_790_095_112_000)
  // Anything that is not a bare timestamp must not be mistaken for one.
  assert.equal(readTimestamp('not a time', 1_234), 1_234)
  assert.equal(readTimestamp('', 1_234), 1_234)
  assert.equal(readTimestamp('', undefined), null)
})

test('parseLaunchctlPrint reads state, last exit code and runs', () => {
  const printed = [
    'gui/501/com.example.job = {',
    '\tactive count = 0',
    '\tstate = not running',
    '\truns = 5',
    '\tlast exit code = 0',
    '}',
  ].join('\n')
  assert.deepEqual(parseLaunchctlPrint(printed), {
    loaded: true, state: 'not running', lastExitCode: 0, runs: 5,
  })
})

test('parseLaunchctlPrint reports an unloaded job as not loaded', () => {
  assert.deepEqual(parseLaunchctlPrint('Could not find service "x" in domain for user'), {
    loaded: false, state: null, lastExitCode: null, runs: null,
  })
})

test('readLastFailureLine reads the newest appended line', () => {
  const raw = 'epoch=100\ttrigger=post-commit\tfirst\nepoch=200\ttrigger=daily\tsecond\twith-tab\n'
  assert.deepEqual(readLastFailureLine(raw), { at: 200_000, message: 'second\twith-tab' })
  assert.equal(readLastFailureLine('\n\n'), null)
})

test('evaluateStatus: unconfigured is unknown, not a failure', () => {
  const result = evaluateStatus({ freshness: null, failure: null, launchd: null, command: null })
  assert.equal(result.level, 'unknown')
  assert.deepEqual(result.reasons.map(r => r.code), ['unconfigured'])
})

test('evaluateStatus: a fresh success is ok', () => {
  const result = evaluateStatus(
    { freshness: { path: '/x', missing: false, at: 1_000_000 }, failure: null, launchd: null, command: null },
    { now: 1_000_000 + HOUR, staleAfterHours: 36 },
  )
  assert.equal(result.level, 'ok')
  assert.deepEqual(result.reasons, [])
  assert.equal(result.ageHours, 1)
})

test('evaluateStatus: stale beyond the threshold is only a warning', () => {
  const result = evaluateStatus(
    { freshness: { path: '/x', missing: false, at: 0 }, failure: null, launchd: null, command: null },
    { now: 48 * HOUR, staleAfterHours: 36 },
  )
  assert.equal(result.level, 'warn')
  assert.deepEqual(result.reasons.map(r => r.code), ['stale'])
})

test('evaluateStatus: a missing status file is bad and names the path', () => {
  const result = evaluateStatus(
    { freshness: { path: '/nope/last-ok', missing: true, at: null }, failure: null, launchd: null, command: null },
    { now: HOUR, staleAfterHours: 36 },
  )
  assert.equal(result.level, 'bad')
  assert.deepEqual(result.reasons, [{ code: 'freshness-missing', path: '/nope/last-ok' }])
})

test('evaluateStatus: a failing launchd job is bad', () => {
  const result = evaluateStatus(
    {
      freshness: { path: '/x', missing: false, at: 1_000_000 },
      failure: null,
      launchd: { label: 'l', loaded: true, state: 'not running', lastExitCode: 7, runs: 2 },
      command: null,
    },
    { now: 1_000_000 + HOUR, staleAfterHours: 36 },
  )
  assert.equal(result.level, 'bad')
  assert.deepEqual(result.reasons.map(r => r.code), ['launchd-failed'])
})

test('evaluateStatus: a failure the last success does not supersede is bad', () => {
  const base = { freshness: { path: '/x', missing: false, at: 2_000_000 }, launchd: null, command: null }
  const newer = evaluateStatus({ ...base, failure: { at: 3_000_000, message: 'boom' } }, { now: 2_000_000 + HOUR })
  assert.equal(newer.level, 'bad')
  assert.ok(newer.reasons.some(r => r.code === 'failure-not-superseded'))

  const older = evaluateStatus({ ...base, failure: { at: 1_000_000, message: 'old' } }, { now: 2_000_000 + HOUR })
  assert.equal(older.level, 'ok')

  // Same second: one run can record a failure and still write last-ok. `>` would hide this.
  const same = evaluateStatus({ ...base, failure: { at: 2_000_000, message: 'skipped' } }, { now: 2_000_000 + HOUR })
  assert.equal(same.level, 'bad')
  assert.ok(same.reasons.some(r => r.code === 'failure-not-superseded'))
})

test('collectStatus wires the injected readers and expands configured paths', async () => {
  const calls = []
  const snapshot = await collectStatus(
    {
      freshnessFile: '~/log/last-ok',
      failureFile: '~/log/last-failure',
      launchdLabel: 'com.example.backup',
      statusCommand: 'true',
      staleAfterHours: 36,
      refreshSeconds: 30,
    },
    {
      home: '/home/u',
      now: 5 * HOUR,
      readFreshnessFile: async path => { calls.push(['fresh', path]); return { path, missing: false, at: 4 * HOUR } },
      readFailureFile: async path => { calls.push(['failure', path]); return null },
      readLaunchd: async label => { calls.push(['launchd', label]); return { label, loaded: true, state: 'not running', lastExitCode: 0, runs: 1 } },
      runStatusCommand: async command => { calls.push(['command', command]); return { exitCode: 0, output: 'fine' } },
      // Pin "no engine": without this the collector would resolve the engine this repo depends on
      // and actually run it against the developer's own machine.
      resolveEngine: IDLE_READERS.resolveEngine,
    },
  )

  assert.deepEqual(calls, [
    ['fresh', '/home/u/log/last-ok'],
    ['failure', '/home/u/log/last-failure'],
    ['launchd', 'com.example.backup'],
    ['command', 'true'],
  ])
  assert.equal(snapshot.level, 'ok')
  assert.equal(snapshot.ageHours, 1)
  assert.equal(snapshot.config.freshnessFile, '/home/u/log/last-ok')
  assert.equal(snapshot.config.refreshSeconds, 30)
})

// A first run must be distinguishable from a broken backup: the shipped default path does not
// exist on a new machine, and the panel needs to say "not set up yet" instead of a bare red
// "Problem". Health itself stays `bad` — this flag only drives the hint.
test('collectStatus marks an untouched default config as not explicitly configured', async () => {
  const snapshot = await collectStatus(
    {
      freshnessFile: DEFAULT_FRESHNESS_FILE,
      failureFile: DEFAULT_FAILURE_FILE,
      launchdLabel: '',
      statusCommand: '',
      staleAfterHours: 36,
      refreshSeconds: 30,
    },
    {
      home: '/home/u',
      readFreshnessFile: async path => ({ path, missing: true, at: null }),
      readFailureFile: async () => null,
      readLaunchd: async () => null,
      runStatusCommand: async () => null,
      // Same pin as above. With no engine AND no record, the panel now names the engine too:
      // "install the engine" and "no backup has run yet" need different fixes.
      resolveEngine: IDLE_READERS.resolveEngine,
    },
  )
  assert.equal(snapshot.explicitlyConfigured, false)
  assert.equal(snapshot.level, 'bad', 'health must not be softened by the hint flag')
  assert.deepEqual(snapshot.reasons.map(r => r.code), ['engine-missing', 'freshness-missing'])
})

// The counterpart, and the case that caught a bug in the first attempt: someone who simply
// follows the convention and never opens the settings form still has an untouched default config.
// The panel must NOT show the setup hint for them, which is why the hint also requires
// `freshness.missing` — this test pins the snapshot shape that condition reads.
test('an untouched default config with an existing file reports not-explicit but not missing', async () => {
  const snapshot = await collectStatus(
    {
      freshnessFile: DEFAULT_FRESHNESS_FILE,
      failureFile: DEFAULT_FAILURE_FILE,
      launchdLabel: '',
      statusCommand: '',
      staleAfterHours: 36,
      refreshSeconds: 30,
    },
    {
      home: '/home/u',
      now: 10 * HOUR,
      readFreshnessFile: async path => ({ path, missing: false, at: 9 * HOUR }),
      readFailureFile: async () => null,
      readLaunchd: async () => null,
      runStatusCommand: async () => null,
    },
  )
  assert.equal(snapshot.explicitlyConfigured, false)
  assert.equal(snapshot.freshness.missing, false)
  assert.equal(snapshot.level, 'ok')
})

test('collectStatus treats any non-default source as explicitly configured', async () => {
  const base = {
    freshnessFile: DEFAULT_FRESHNESS_FILE,
    failureFile: DEFAULT_FAILURE_FILE,
    launchdLabel: '',
    statusCommand: '',
    staleAfterHours: 36,
    refreshSeconds: 30,
  }
  const deps = {
    home: '/home/u',
    readFreshnessFile: async path => ({ path, missing: true, at: null }),
    readFailureFile: async () => null,
    readLaunchd: async () => null,
    runStatusCommand: async () => null,
  }
  for (const override of [
    { freshnessFile: '/custom/last-ok' },
    { failureFile: '/custom/failures' },
    { launchdLabel: 'com.example.backup' },
    { statusCommand: 'true' },
  ]) {
    const snapshot = await collectStatus({ ...base, ...override }, deps)
    assert.equal(
      snapshot.explicitlyConfigured,
      true,
      `expected explicitlyConfigured for ${JSON.stringify(override)}`,
    )
  }
})

// The Harness indexes the client module table by PACKAGE NAME, so these four must agree or the
// Client half silently never loads. This is exactly how a sibling plugin broke on 0.2.x.

test('parseStatusJson accepts our document and normalises every field', () => {
  const parsed = parseStatusJson(STATUS_JSON)
  assert.equal(parsed.schema, 'cold-backup.status/1')
  assert.equal(parsed.verdict, 'bad')
  assert.equal(parsed.counts.problems, 1)
  assert.deepEqual(parsed.orphans, ['repos/gone'])
  assert.equal(parsed.targets.length, 2)
  assert.equal(parsed.targets[0].sha256.length, 64)
  assert.equal(parsed.targets[1].sha256, null)
  assert.equal(parsed.targets[1].dirty, null)
  // 原因带上来源前缀：引擎的词汇表与插件自己的那套必须分得开。
  assert.equal(parsed.reasons[0].code, 'engine:behind')
  assert.equal(parsed.reasons[0].target, 'demo')
  assert.equal(parsed.lastFailure.trigger, 'daily')
})

test('parseStatusJson refuses anything that is not ours', () => {
  assert.equal(parseStatusJson(''), null)
  assert.equal(parseStatusJson('   '), null)
  assert.equal(parseStatusJson('not json'), null)
  assert.equal(parseStatusJson('[]'), null)
  assert.equal(parseStatusJson('null'), null)
  assert.equal(parseStatusJson('{"schema":"cold-backup.status/1"}'), null, 'verdict 必须有')
  assert.equal(parseStatusJson('{"schema":"cold-backup.status/1","verdict":"maybe"}'), null)
  assert.equal(parseStatusJson('{"schema":"other.thing/1","verdict":"ok"}'), null, 'schema 必须匹配')
  assert.equal(parseStatusJson(undefined), null)
})

test('evaluateStatus: a parsed document is authoritative for level and reasons', () => {
  const parsed = parseStatusJson(STATUS_JSON)
  // 通用来源全都没有 → 若没有文档，这里会判 unknown；有文档则按它走。
  const result = evaluateStatus({ document: parsed }, { now: 1_790_932_000 })
  assert.equal(result.level, 'bad')
  assert.equal(result.source, 'engine')
  assert.deepEqual(result.reasons.map(r => r.code), ['engine:behind'])

  const okDocument = parseStatusJson(JSON.stringify({ ...STATUS_DOCUMENT, verdict: 'ok', reasons: [] }))
  assert.equal(evaluateStatus({ document: okDocument }, {}).level, 'ok')
  // 引擎说好、但通用来源说坏：仍以引擎为准（它才是跑了全部规则的那个）。
  assert.equal(evaluateStatus({
    document: okDocument,
    freshness: { path: '/x', missing: true, at: null },
  }, {}).level, 'ok')
})

test('evaluateStatus: a configured but unusable JSON source is bad, not unknown', () => {
  const result = evaluateStatus({ engineFailed: true }, {})
  assert.equal(result.level, 'bad')
  assert.equal(result.reasons[0].code, 'status-json-failed')
  assert.equal(result.source, 'engine')
  // 没有配任何东西才是 unknown —— 两者不能混。
  assert.equal(evaluateStatus({}, {}).level, 'unknown')
})

test('collectStatus runs the JSON command, keeps stdout on exit 1, and exposes the document', async () => {
  const payload = await collectStatus(
    { statusJsonCommand: 'cold-backup --status --json' },
    {
      ...IDLE_READERS,
      // 脚本在「有问题」时正是这样：合法 JSON + 退出码 1。丢掉 stdout 就把问题变成了读不到状态。
      runJsonStatusCommand: async () => ({ exitCode: 1, output: STATUS_JSON }),
      home: '/Users/x',
    },
  )
  assert.equal(payload.level, 'bad')
  assert.equal(payload.engine.configured, true)
  assert.equal(payload.engine.exitCode, 1)
  assert.equal(payload.engine.output, null)
  assert.equal(payload.engine.document.targets.length, 2)
  assert.equal(payload.explicitlyConfigured, true)
  assert.equal(payload.config.statusJsonCommand, 'cold-backup --status --json')
})

test('collectStatus reports a broken JSON source instead of silently using another one', async () => {
  const payload = await collectStatus(
    { statusJsonCommand: 'nonsense', statusCommand: 'true' },
    {
      ...IDLE_READERS,
      runJsonStatusCommand: async () => ({ exitCode: 127, output: 'command not found' }),
      runStatusCommand: async () => ({ exitCode: 0, output: 'ok' }),
      home: '/Users/x',
    },
  )
  assert.equal(payload.level, 'bad')
  assert.equal(payload.engine.document, null)
  assert.equal(payload.engine.exitCode, 127)
  assert.equal(payload.engine.output, 'command not found')
  assert.deepEqual(payload.reasons.map(r => r.code), ['status-json-failed'])
})

test('collectStatus leaves the generic path untouched when no JSON source is set', async () => {
  const payload = await collectStatus(
    { freshnessFile: '~/last-ok' },
    {
      ...IDLE_READERS,
      readFreshnessFile: async () => ({ path: '/Users/x/last-ok', missing: false, at: 1_790_931_285_000 }),
      home: '/Users/x',
      now: 1_790_931_285_000 + 60_000,
    },
  )
  assert.equal(payload.engine, null)
  assert.equal(payload.level, 'ok')
  assert.deepEqual(payload.reasons, [])
})

// ── v2.0: where the engine comes from, and how it is run ─────────────────────────────────────
// The point: the engine is resolved from this package (dependency) or from PATH, and it is run
// with a **fixed argv** — nothing a caller sends can influence either. Every fixture is a mktemp
// directory; the real machine is never consulted.

const ENGINE_STUB = '#!/bin/bash\nexit 0\n'

/** Build a throwaway tree; returns its path. `files` maps a relative path to its content. */
function engineFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cb-engine-'))
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(relative)), { recursive: true })
    writeFileSync(join(dir, relative), content)
  }
  return dir
}

const NO_DEPENDENCY = { resolve: () => { throw new Error('not installed') } }

test('resolveEngine prefers the dependency this package declares', () => {
  const dir = engineFixture({
    'bin/cold-backup': ENGINE_STUB,
    'package.json': JSON.stringify({ name: 'cold-backup', version: '9.9.9' }),
  })
  try {
    const resolved = resolveEngine({
      require: { resolve: () => join(dir, 'package.json') },
      env: { PATH: '/nowhere' },
      platform: 'darwin',
    })
    assert.equal(resolved.source, 'dependency')
    assert.equal(resolved.path, join(dir, 'bin', 'cold-backup'))
    assert.equal(resolved.version, '9.9.9')
    assert.equal(resolved.reason, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveEngine falls back to PATH when the dependency is absent (the pre-2.0 setup)', () => {
  const dir = engineFixture({ 'cold-backup': ENGINE_STUB })
  try {
    const resolved = resolveEngine({
      require: NO_DEPENDENCY,
      env: { PATH: `/nowhere:${dir}` },
      platform: 'linux',
    })
    assert.equal(resolved.source, 'path')
    assert.equal(resolved.path, join(dir, 'cold-backup'))
    // A PATH copy carries no version we can trust without running it, so we report none.
    assert.equal(resolved.version, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveEngine says which kind of "missing" it is', () => {
  assert.deepEqual(
    resolveEngine({ require: NO_DEPENDENCY, env: { PATH: '/nowhere' }, platform: 'darwin' }),
    { path: null, source: null, version: null, reason: 'missing-dependency' },
  )
  // A resolvable manifest whose binary is gone is a broken install, not an absent one.
  const dir = engineFixture({ 'package.json': JSON.stringify({ name: 'cold-backup', version: '1.0.3' }) })
  try {
    const resolved = resolveEngine({
      require: { resolve: () => join(dir, 'package.json') },
      env: { PATH: '/nowhere' },
      platform: 'darwin',
    })
    assert.equal(resolved.reason, 'missing-binary')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveEngine refuses platforms the engine does not ship for', () => {
  const resolved = resolveEngine({ require: NO_DEPENDENCY, env: { PATH: '/nowhere' }, platform: 'win32' })
  assert.equal(resolved.path, null)
  assert.equal(resolved.reason, 'unsupported-platform')
})

test('collectStatus runs the resolved engine with a fixed argv and reports its provenance', async () => {
  const seen = []
  const payload = await collectStatus(
    {},
    {
      ...IDLE_READERS,
      resolveEngine: () => ({ path: '/opt/engine/cold-backup', source: 'dependency', version: '1.0.3', reason: null }),
      runEngineJson: async (argv) => { seen.push(argv); return { exitCode: 0, output: STATUS_JSON } },
      home: '/Users/x',
    },
  )
  // The whole argv: the resolved path plus two constants. Nothing from config, nothing from a caller.
  assert.deepEqual(seen, [['/opt/engine/cold-backup', '--status', '--json']])
  assert.equal(payload.engineSource, 'dependency')
  assert.equal(payload.engineVersion, '1.0.3')
  assert.equal(payload.enginePath, '/opt/engine/cold-backup')
  assert.equal(payload.engine.document.targets.length, 2)
  assert.equal(payload.level, 'bad')
})

test('a configured JSON command still wins over the engine', async () => {
  let engineRan = 0
  const payload = await collectStatus(
    { statusJsonCommand: 'my-own-status --json' },
    {
      ...IDLE_READERS,
      resolveEngine: () => ({ path: '/opt/engine/cold-backup', source: 'dependency', version: '1.0.3', reason: null }),
      runJsonStatusCommand: async () => ({ exitCode: 0, output: STATUS_JSON }),
      runEngineJson: async () => { engineRan += 1; return { exitCode: 0, output: STATUS_JSON } },
      home: '/Users/x',
    },
  )
  assert.equal(engineRan, 0)
  assert.equal(payload.engineSource, 'config')
  assert.equal(payload.enginePath, null)
  assert.equal(payload.config.statusJsonCommand, 'my-own-status --json')
})

test('bundledEngine: false keeps the plugin strictly passive', async () => {
  let resolverCalls = 0
  let engineRuns = 0
  const payload = await collectStatus(
    { bundledEngine: false },
    {
      ...IDLE_READERS,
      resolveEngine: () => { resolverCalls += 1; return { path: '/opt/engine/cold-backup', source: 'dependency', version: '1.0.3', reason: null } },
      runEngineJson: async () => { engineRuns += 1; return { exitCode: 0, output: STATUS_JSON } },
      home: '/Users/x',
    },
  )
  assert.equal(resolverCalls, 0)
  assert.equal(engineRuns, 0)
  assert.equal(payload.engine, null)
  assert.equal(payload.engineSource, null)
  assert.equal(payload.config.bundledEngine, false)
})

test('a missing engine is named when it is the reason the panel has nothing to show', async () => {
  const payload = await collectStatus(
    {},
    {
      ...IDLE_READERS,
      readFreshnessFile: async () => ({ path: '/Users/x/last-ok', missing: true, at: null }),
      resolveEngine: () => ({ path: null, source: null, version: null, reason: 'missing-dependency' }),
      home: '/Users/x',
    },
  )
  // Root cause first, then the symptom it explains.
  assert.deepEqual(payload.reasons.map(reason => reason.code), ['engine-missing', 'freshness-missing'])
  assert.equal(payload.engineMissing, true)
  // Same level a missing backup record has always had: the record should be there. The Client half
  // pairs it with the "not set up yet" hint for an untouched install, so it never reads as a scare.
  assert.equal(payload.level, 'bad')
})

test('a missing engine stays quiet when another source explains the panel', async () => {
  const payload = await collectStatus(
    {},
    {
      ...IDLE_READERS,
      readFreshnessFile: async () => ({ path: '/Users/x/last-ok', missing: false, at: 1_790_931_285_000 }),
      resolveEngine: () => ({ path: null, source: null, version: null, reason: 'missing-dependency' }),
      home: '/Users/x',
      now: 1_790_931_285_000 + 60_000,
    },
  )
  assert.deepEqual(payload.reasons, [])
  assert.equal(payload.level, 'ok')
})


// ── v2.0 第 2 步：动作层的信任判据、动作表、进度与作业生命周期 ─────────────────────────
// 这些用例一条都不许碰到真实机器：spawn / 时钟 / 文件读取全部注入。

const LOOPBACK = { remoteAddress: '127.0.0.1' }

function request(headers = {}, socket = LOOPBACK) {
  return { method: 'POST', headers: { host: '127.0.0.1:19387', ...headers }, socket }
}

test('trust: loopback + marker is enough, and cross-site is always refused', () => {
  // 桌面 app 走自己的请求管道时没有 Fetch Metadata 头，标记头就是给它的那条路。
  assert.equal(isTrustedRequest(request({ [MARKER_HEADER]: '1' })), true)
  // 浏览器同源 fetch 会带 sec-fetch-site，同样放行。
  assert.equal(isTrustedRequest(request({ 'sec-fetch-site': 'same-origin' })), true)
  // 跨站：这就是 CSRF，一律拒。
  const crossSite = trustReport(request({ 'sec-fetch-site': 'cross-site', [MARKER_HEADER]: '1' }))
  assert.equal(crossSite.trusted, false)
  assert.ok(refusalReasons(crossSite).includes('cross-site'))
  // Origin 存在时必须与 Host 一致。
  assert.equal(trustReport(request({ origin: 'http://evil.example' })).trusted, false)
  assert.equal(trustReport(request({ origin: 'http://127.0.0.1:19387' })).trusted, true)
  // 非 loopback 一律拒。
  assert.equal(trustReport(request({ [MARKER_HEADER]: '1' }, { remoteAddress: '10.0.0.9' })).trusted, false)
  // 什么信号都没有、也没有标记头 → 拒，并说明原因。
  const bare = trustReport(request())
  assert.equal(bare.trusted, false)
  assert.ok(refusalReasons(bare).includes('missing-marker'))
})

test('trust: a missing Host header is refused (it is what Origin is compared against)', () => {
  assert.equal(isTrustedRequest({ method: 'POST', headers: { [MARKER_HEADER]: '1' }, socket: LOOPBACK }), false)
})

test('actions: the vocabulary is fixed and argv never comes from input', () => {
  assert.deepEqual(ACTION_IDS.sort(), ['backup', 'daily', 'prune', 'verify', 'verifyFix'])
  for (const [id, action] of Object.entries(ACTIONS)) {
    assert.ok(Array.isArray(action.argv), id)
    for (const arg of action.argv) assert.match(arg, /^--[a-z-]+(=ui)?$/, `${id}: ${arg}`)
  }
  assert.equal(ACTIONS.verifyFix.destructive, true)
  assert.equal(ACTIONS.prune.destructive, true)
  assert.equal(ACTIONS.backup.destructive, false)
  assert.deepEqual(sectionWeights(['backup', 'verify', 'status']), { backup: 0.7, verify: 0.25, status: 0.05 })
  assert.deepEqual(sectionWeights(['verify']), { verify: 1 })
  assert.deepEqual(sectionWeights([]), {})
})

test('progress: parsing survives a half-written line and strips ANSI', () => {
  const text = '{"v":1,"phase":"plan","section":"backup","total":1,"units":[]}\n{"v":1,"phase":"back\n\n{"v":1,"done":true,"exitCode":0,"ms":10}\n'
  const events = parseProgress(text)
  assert.equal(events.length, 2)
  assert.equal(events[1].done, true)
  assert.equal(stripAnsi('\u001b[32m✓\u001b[0m ok'), '✓ ok')
})

test('progress: the percentage weighs phases, the counters stay exact', () => {
  const events = [
    { v: 1, phase: 'plan', section: 'backup', total: 2, units: [{ kind: 'repo', label: 'a', weight: 3 }, { kind: 'snapshot', label: 'b', weight: 1 }] },
    { v: 1, phase: 'backup', state: 'start', kind: 'repo', label: 'a' },
    { v: 1, phase: 'backup', state: 'done', kind: 'repo', label: 'a', result: 'skipped', ms: 10 },
  ]
  const half = summarizeProgress(events, { sections: ACTIONS.daily.sections })
  assert.equal(half.phase, 'backup')
  assert.equal(half.current, null)
  assert.deepEqual(half.sections.backup, { done: 1, total: 2 })
  // 权重 3/4 完成 → 0.7 × 0.75 = 52.5（浮点 52.499…）→ 52。不是 50：大目标真的占得多。
  assert.equal(half.percent, 52)

  const verifying = summarizeProgress([...events, { v: 1, phase: 'verify', done: 1, total: 4, label: 'a', ok: true }], { sections: ACTIONS.daily.sections })
  assert.equal(verifying.phase, 'verify')
  assert.equal(verifying.current, 'a')
  assert.deepEqual(verifying.sections.verify, { done: 1, total: 4 })
  assert.equal(verifying.percent, 59)

  const finished = summarizeProgress([...events, { v: 1, phase: 'verify', done: 4, total: 4 }, { v: 1, phase: 'status' }, { v: 1, done: true, exitCode: 0, ms: 1234 }], { sections: ACTIONS.daily.sections })
  assert.equal(finished.finished, true)
  assert.equal(finished.percent, 100)
  assert.equal(finished.exitCode, 0)
  assert.equal(finished.engineMs, 1234)

  // 引擎太旧、没写任何进度 → 不编数字：percent 为 null，面板画流动条。
  assert.equal(summarizeProgress([], { sections: ACTIONS.backup.sections }).percent, null)
})

function fakeChild() {
  const handlers = {}
  return {
    stdout: { on: (event, fn) => { handlers[`stdout:${event}`] = fn } },
    stderr: { on: (event, fn) => { handlers[`stderr:${event}`] = fn } },
    on: (event, fn) => { handlers[event] = fn },
    kill: signal => { handlers.killed = signal; return true },
    handlers,
  }
}

function runnerFixture({ spawn, files = {}, engine = { path: '/opt/engine/cold-backup', source: 'dependency' } } = {}) {
  const children = []
  const runner = createJobRunner({
    resolveEngine: () => engine,
    progressDir: '/tmp/cb-progress',
    now: () => 1_000,
    spawn: spawn ?? ((file, args, options) => {
      const child = fakeChild()
      children.push({ file, args, options, child })
      return child
    }),
    mkdir: async () => {},
    rm: async () => {},
    readFile: async path => {
      if (!(path in files)) throw new Error('ENOENT')
      return files[path]
    },
  })
  return { runner, children }
}

test('job runner: fixed argv, single flight, engine and destructive gates', async () => {
  const { runner, children } = runnerFixture()

  const disabled = await runner.start('prune', { allowDestructive: false })
  assert.equal(disabled.error, 'destructive-disabled')
  assert.equal(children.length, 0, 'a refused action must not spawn anything')

  const unknown = await runner.start('rm-rf')
  assert.equal(unknown.error, 'unknown-action')

  const first = await runner.start('backup')
  assert.equal(first.job.action, 'backup')
  assert.equal(children.length, 1)
  assert.equal(children[0].file, '/bin/bash')
  assert.deepEqual(children[0].args, ['/opt/engine/cold-backup', '--trigger=ui'])
  assert.equal(children[0].options.env.COLD_BACKUP_PROGRESS_FILE, '/tmp/cb-progress/job-rs-1.jsonl')

  const second = await runner.start('backup')
  assert.equal(second.error, 'busy')

  assert.equal(runner.cancel(), true)
  assert.equal(children[0].child.handlers.killed, 'SIGTERM')

  children[0].child.handlers.close(0)
  const done = await runner.status()
  assert.equal(done.running, false)
  assert.equal(done.exitCode, 0)
  await runner.dispose()
  assert.equal(await runner.status(), null)
})

test('job runner: keeps the progress directory bounded across jobs', async () => {
  const removed = []
  const children = []
  const runner = createJobRunner({
    resolveEngine: () => ({ path: '/x/cold-backup', source: 'dependency' }),
    progressDir: '/tmp/cb-progress',
    now: () => 1_000,
    spawn: () => { const child = fakeChild(); children.push(child); return child },
    mkdir: async () => {},
    rm: async path => { removed.push(path) },
    readFile: async () => { throw new Error('ENOENT') },
  })
  await runner.start('backup')
  const first = removed.length
  // 第一个作业结束后再起第二个（运行中起第二个本来就是 409，见上一条用例）。
  children[0].handlers.close(0)
  await runner.start('verify')
  // 进程被硬杀时 dispose 不会执行，所以「起新作业时删掉上一个的进度文件」是目录有界的保证。
  assert.ok(removed.length > first, 'the previous job progress file must be dropped on the next start')
  assert.ok(removed.some(path => path.endsWith('job-rs-1.jsonl')), removed.join(','))
  await runner.dispose()
})

test('job runner: refuses to start when no engine resolves, and reports its reason', async () => {
  const { runner, children } = runnerFixture({ engine: { path: null, source: null, reason: 'missing-dependency' } })
  const result = await runner.start('verify')
  assert.equal(result.error, 'engine-missing')
  assert.equal(result.reason, 'missing-dependency')
  assert.equal(children.length, 0)
})

test('job runner: reads the progress file the engine wrote, and kills on dispose', async () => {
  const progress = [
    '{"v":1,"phase":"plan","section":"backup","total":1,"units":[{"kind":"repo","label":"a","weight":2}]}',
    '{"v":1,"phase":"backup","state":"done","kind":"repo","label":"a","result":"stored","ms":5}',
  ].join('\n')
  const { runner, children } = runnerFixture({ files: { '/tmp/cb-progress/job-rs-1.jsonl': progress } })
  await runner.start('backup')
  const view = await runner.status()
  assert.equal(view.percent, 100)
  assert.deepEqual(view.sections.backup, { done: 1, total: 1 })
  await runner.dispose()
  assert.equal(children[0].child.handlers.killed, 'SIGTERM')
})

test('routes: POST refuses untrusted callers, disabled actions and bad bodies without spawning', async () => {
  const routes = new Map()
  const ctx = {
    effect: fn => fn(),
    logger: { warn() {}, info() {} },
    webServer: { register: route => { routes.set(route.path, route.handler); return () => {} } },
  }
  apply(ctx, { freshnessFile: '/tmp/none/last-ok', failureFile: '/tmp/none/last-failure' })
  assert.ok(routes.has(ACTION_PATH) && routes.has(JOB_PATH) && routes.has(CANCEL_PATH) && routes.has(STATUS_PATH))

  const respond = async (path, req) => {
    const res = {
      statusCode: null,
      body: null,
      writeHead(code) { this.statusCode = code },
      end(payload) { this.body = payload ? JSON.parse(payload) : null },
    }
    await routes.get(path)(req, res)
    return res
  }
  const post = (headers, body = '') => ({
    method: 'POST',
    headers: { host: '127.0.0.1:19387', ...headers },
    socket: LOOPBACK,
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) },
  })

  // 跨站 → 403，且带上原因。
  const crossSite = await respond(ACTION_PATH, post({ 'sec-fetch-site': 'cross-site', [MARKER_HEADER]: '1' }, '{"action":"backup"}'))
  assert.equal(crossSite.statusCode, 403)
  assert.equal(crossSite.body.error, 'untrusted-request')
  assert.ok(crossSite.body.reasons.includes('cross-site'))

  // 同源但没有标记头（例如某种非浏览器客户端）→ 403。
  const bare = await respond(ACTION_PATH, post({}, '{"action":"backup"}'))
  assert.equal(bare.statusCode, 403)

  // 信任通过但 body 不合法 → 400（还没到起进程那一步）。
  const badBody = await respond(ACTION_PATH, post({ [MARKER_HEADER]: '1' }, 'not json'))
  assert.equal(badBody.statusCode, 400)
  assert.equal(badBody.body.error, 'invalid-body')

  // GET 动词不对 → 405。
  assert.equal((await respond(ACTION_PATH, post({ [MARKER_HEADER]: '1' }))).statusCode, 400)

  // 读路由保持开放且只读：没有作业时返回 job: null。
  const job = await respond(JOB_PATH, { method: 'GET', headers: { host: '127.0.0.1:19387' }, socket: LOOPBACK })
  assert.equal(job.statusCode, 200)
  assert.equal(job.body.job, null)
})


test('the client half renders the action buttons and the progress bar (v2.0)', async () => {
  const job = {
    id: 'job-1',
    action: 'daily',
    running: true,
    startedAt: 1_790_000_000_000,
    finishedAt: null,
    exitCode: null,
    error: null,
    elapsedMs: 42_000,
    phase: 'verify',
    current: 'plugins/dsh-archived',
    percent: 59,
    sections: { backup: { done: 2, total: 2 }, verify: { done: 1, total: 4 } },
    engineFinished: false,
    engineExitCode: null,
    engineMs: null,
    outputTail: '✓ a.bundle：结构完整',
  }
  const payload = {
    level: 'ok',
    reasons: [],
    ageHours: 0.1,
    explicitlyConfigured: true,
    freshness: { path: '/x/last-ok', missing: false, at: 1_790_000_000_000 },
    failure: null,
    launchd: null,
    command: null,
    engine: null,
    engineSource: 'dependency',
    engineVersion: '1.0.3',
    enginePath: '/opt/engine/cold-backup',
    config: { refreshSeconds: 30, allowActions: true, allowDestructive: false },
  }
  const texts = await renderClientPanel(payload, job)

  assert.ok(texts.includes('actions'), 'the actions heading must be rendered')
  assert.ok(texts.includes('actionBackup') && texts.includes('actionVerify') && texts.includes('actionDaily'), 'the three safe actions')
  assert.ok(!texts.includes('actionPrune'), 'destructive actions stay hidden while allowDestructive is off')
  assert.ok(texts.includes('progress'), 'the progress heading')
  assert.ok(texts.some(text => text.includes('59%')), 'the weighted percentage is shown')
  // 计数器走 format() 的占位符，而测试基座的 t() 返回 key 本身（本文件既有用例都按 key 断言）：
  // 计数来自引擎的精确事件，这里验的是这一行确实渲染了。
  assert.ok(texts.some(text => text.includes('progressCounter')), 'the exact per-phase counter line is rendered')
  assert.ok(texts.some(text => text.includes('plugins/dsh-archived')), 'the current target is named')
  assert.ok(texts.some(text => text.includes('✓ a.bundle')), 'the engine output tail is shown')
  assert.ok(nodes => true)

  // allowDestructive on → the two delete-capable actions appear, still behind a second click.
  const withDestructive = await renderClientPanel({ ...payload, config: { ...payload.config, allowDestructive: true } }, { ...job, running: false, exitCode: 0, percent: 100 })
  assert.ok(withDestructive.includes('actionPrune') && withDestructive.includes('actionVerifyFix'), 'destructive actions appear only when enabled')

  // allowActions off → the whole block degrades to a sentence, no buttons.
  const readOnly = await renderClientPanel({ ...payload, config: { ...payload.config, allowActions: false } }, null)
  assert.ok(readOnly.includes('actionsDisabled'), 'the disabled note is shown')
  assert.ok(!readOnly.includes('actionBackup'), 'no action buttons when actions are off')
})

test('the package name, patch id, ENTRY_ID and client module id all agree', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  assert.equal(name, manifest.name)
  assert.equal(ENTRY_ID, manifest.name)
  assert.match(patch, new RegExp(`id:\\s*${manifest.name}\\b`))
  assert.match(patch, new RegExp(`name:\\s*'${manifest.name}'`))
  assert.match(client, new RegExp(`id:\\s*'${manifest.name}'`))
})

test('the manifest points the bundle patch and client at real files', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const entry of manifest.files) {
    assert.doesNotThrow(
      () => fileURLToPath(new URL(entry, new URL('../', import.meta.url))),
      `files entry should resolve: ${entry}`,
    )
  }
  assert.ok(STATUS_PATH.startsWith('/'), 'the status route must be an absolute path')
  assert.ok(manifest.files.includes('client.js'))
  assert.ok(manifest.files.includes('cordis.patch.yml'))
})

test('the defaults describe the cold-backup convention', () => {
  assert.equal(DEFAULT_FRESHNESS_FILE, '~/Library/Logs/cold-backup/last-ok')
  assert.equal(DEFAULT_FAILURE_FILE, '~/Library/Logs/cold-backup/last-failure')
})

// The Client half is plain browser JavaScript. Stub the loader and assert the contract the
// Harness relies on, plus that both dictionaries stay in step.
test('the client half loads through __ModuleLoader__ and registers one settings page', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loaded
  const window = {
    __ModuleLoader__: {
      load: options => { loaded = options },
    },
  }
  const require = specifier => {
    if (specifier === 'react') return { useState: () => [], useRef: () => ({}), useEffect: () => {}, useCallback: fn => fn }
    if (specifier === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
    throw new Error(`unexpected require: ${specifier}`)
  }
  // The file is a script, not a module: evaluate it with the stubbed globals in scope.
  new Function('window', 'document', source)(window, undefined)

  assert.equal(loaded.id, 'dsh-cold-backup')
  const exports = loaded.factory(require)
  assert.deepEqual(exports.inject, ['slots', 'locale'])

  const registered = []
  const namespaces = []
  const ctx = {
    effect: fn => fn(),
    locale: {
      register: (namespace, dictionaries) => { namespaces.push([namespace, dictionaries]); return () => {} },
      bind: () => key => key,
    },
    slots: {
      inject: (slot, fn) => { assert.equal(slot, 'settings.section'); fn() },
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
  exports.apply(ctx)

  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.id, 'dsh-cold-backup')
  assert.equal(registered[0].options.name, 'settings.section')
  assert.equal(typeof registered[0].component, 'function')

  const [namespace, dictionaries] = namespaces[0]
  assert.equal(namespace, 'settings.dshColdBackup')
  assert.deepEqual(
    Object.keys(dictionaries.zh).sort(),
    Object.keys(dictionaries.en).sort(),
    'zh and en dictionaries must have identical keys',
  )
})

/**
 * Render the panel once with a payload we control and collect every text node.
 *
 * The real component loads its data through `fetch` in an effect; here `useState` simply hands
 * back the state we want, so one pass is enough — no timers, no re-render loop. This is what
 * actually exercises the new detail block: `jsx`/`jsxs` are stubs, but the component body runs.
 */
async function renderClientPanel (data, job = null) {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const nodes = []
  let loaded
  const window = { __ModuleLoader__: { load: options => { loaded = options } } }
  const states = [{ status: 'ready', data, job, error: null }]
  const require = specifier => {
    if (specifier === 'react') {
      return {
        useState: initial => [states.length > 0 ? states.shift() : initial, () => {}],
        useRef: () => ({ current: null }),
        useEffect: () => {},
        useCallback: fn => fn,
      }
    }
    if (specifier === 'react/jsx-runtime') {
      const jsx = (type, props) => {
        const node = { type, props: props ?? {} }
        nodes.push(node)
        return node
      }
      return { jsx, jsxs: jsx }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }
  new Function('window', 'document', source)(window, undefined)

  let component = null
  const ctx = {
    effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key },
    slots: {
      inject: (slot, fn) => fn(),
      register: (options, registered) => { component = registered; return () => {} },
    },
  }
  loaded.factory(require).apply(ctx)

  const collect = value => {
    if (value === null || value === undefined || value === false) return []
    if (Array.isArray(value)) return value.flatMap(collect)
    if (typeof value === 'object') {
      // Components stay opaque to these stubs — `Row` never actually runs — so its `label` prop is
      // followed as text too. Without that, a row's own name would be invisible to assertions.
      const label = value.props?.label
      return [
        ...(typeof label === 'string' ? [label] : []),
        ...collect(value.props?.children),
      ]
    }
    return [String(value)]
  }
  component({ t: key => key })
  return collect(nodes.map(node => node.props.children))
}

test('the client half renders the engine detail block from a cold-backup.status/1 document', async () => {
  const payload = {
    level: 'bad',
    reasons: [{ code: 'engine:behind', target: 'demo', message: '备份落后（HEAD abc）' }],
    ageHours: null,
    explicitlyConfigured: true,
    freshness: { path: '/x', missing: true, at: null },
    failure: null,
    launchd: null,
    command: null,
    engine: { configured: true, exitCode: 1, document: parseStatusJson(STATUS_JSON), output: null },
    engineSource: 'dependency',
    engineVersion: '1.0.3',
    enginePath: '/opt/engine/cold-backup',
    config: { refreshSeconds: 30 },
  }
  const texts = await renderClientPanel(payload)

  assert.ok(texts.includes('detail'), 'the detail heading must be rendered')
  assert.ok(texts.includes('demo'), 'every target label must be rendered')
  assert.ok(texts.includes('scratch'), 'snapshot targets too')
  assert.ok(texts.some(text => text.startsWith('[behind] demo：')), 'engine reasons keep their code and target')
  assert.ok(texts.some(text => text.includes('stateBehind') === false && text.includes('备份落后')), 'the script sentence is shown')
  // v2.0: the panel says which engine answered (the bundled dependency, PATH, or a configured
  // command) — that line is how an operator notices a stale global install taking priority.
  assert.ok(texts.includes('engine'), 'the engine provenance row must be rendered')
  assert.ok(texts.includes('engineFromDependency'), 'and it must name the dependency as the source')
})

test('the client half says so when the JSON source is configured but unusable', async () => {
  const payload = {
    level: 'bad',
    reasons: [{ code: 'status-json-failed' }],
    ageHours: null,
    explicitlyConfigured: true,
    freshness: null,
    failure: null,
    launchd: null,
    command: null,
    engine: { configured: true, exitCode: 127, document: null, output: 'command not found' },
    config: { refreshSeconds: 30 },
  }
  const texts = await renderClientPanel(payload)
  assert.ok(texts.includes('reasonStatusJsonFailed'), 'the broken source must be named, not hidden')
  assert.ok(!texts.includes('demo'), 'a document that failed to parse must not render target rows')
})
