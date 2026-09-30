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
  readLastFailureLine,
  readTimestamp,
} from '../index.js'

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

// The Harness indexes the client module table by PACKAGE NAME, so these four must agree or the
// Client half silently never loads. This is exactly how a sibling plugin broke on 0.2.x.
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
