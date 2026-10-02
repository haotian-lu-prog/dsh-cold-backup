// Tests for dsh-dev-backup. `node --test`, no live Harness required: the Host half is written
// as pure functions plus one injectable collector, so every rule is covered here.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  DEFAULT_FAILURE_FILE,
  DEFAULT_FRESHNESS_FILE,
  ENTRY_ID,
  STATUS_PATH,
  collectStatus,
  evaluateStatus,
  expandHome,
  name,
  parseLaunchctlPrint,
  parseStatusJson,
  readLastFailureLine,
  readTimestamp,
} from '../index.js'

/** A document shaped exactly like `backup-dev.sh --status --json` (contract dev-backup.status/1). */
const STATUS_DOCUMENT = {
  schema: 'dev-backup.status/1',
  generatedAt: 1_790_932_000,
  root: '/Users/x/dev',
  dest: '/Users/x/OneDrive/dev-backup',
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
    },
  )
  assert.equal(snapshot.explicitlyConfigured, false)
  assert.equal(snapshot.level, 'bad', 'health must not be softened by the hint flag')
  assert.deepEqual(snapshot.reasons.map(r => r.code), ['freshness-missing'])
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
  assert.equal(parsed.schema, 'dev-backup.status/1')
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
  assert.equal(parseStatusJson('{"schema":"dev-backup.status/1"}'), null, 'verdict 必须有')
  assert.equal(parseStatusJson('{"schema":"dev-backup.status/1","verdict":"maybe"}'), null)
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
    { statusJsonCommand: 'backup-dev.sh --status --json' },
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
  assert.equal(payload.config.statusJsonCommand, 'backup-dev.sh --status --json')
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

test('the defaults describe the dev-backup convention', () => {
  assert.equal(DEFAULT_FRESHNESS_FILE, '~/Library/Logs/dev-backup/last-ok')
  assert.equal(DEFAULT_FAILURE_FILE, '~/Library/Logs/dev-backup/last-failure')
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

  assert.equal(loaded.id, 'dsh-dev-backup')
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
  assert.equal(registered[0].options.id, 'dsh-dev-backup')
  assert.equal(registered[0].options.name, 'settings.section')
  assert.equal(typeof registered[0].component, 'function')

  const [namespace, dictionaries] = namespaces[0]
  assert.equal(namespace, 'settings.dshDevBackup')
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
async function renderClientPanel (data) {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const nodes = []
  let loaded
  const window = { __ModuleLoader__: { load: options => { loaded = options } } }
  const states = [{ status: 'ready', data, error: null }]
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
    if (typeof value === 'object') return collect(value.props?.children)
    return [String(value)]
  }
  component({ t: key => key })
  return collect(nodes.map(node => node.props.children))
}

test('the client half renders the engine detail block from a dev-backup.status/1 document', async () => {
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
    config: { refreshSeconds: 30 },
  }
  const texts = await renderClientPanel(payload)

  assert.ok(texts.includes('detail'), 'the detail heading must be rendered')
  assert.ok(texts.includes('demo'), 'every target label must be rendered')
  assert.ok(texts.includes('scratch'), 'snapshot targets too')
  assert.ok(texts.some(text => text.startsWith('[behind] demo：')), 'engine reasons keep their code and target')
  assert.ok(texts.some(text => text.includes('stateBehind') === false && text.includes('备份落后')), 'the script sentence is shown')
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
