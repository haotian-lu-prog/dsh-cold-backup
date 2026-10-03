// `engine.js` — where the plugin finds the cold-backup CLI.
//
// v2.0 ships the engine as an npm dependency of this package, so the common install
// (`dsh plugin add dsh-cold-backup`) needs no separate `npm i -g cold-backup`. This module
// answers exactly one question — *which executable should we run* — and nothing else: it never
// reads a request, never runs anything, never writes.
//
// Resolution order (also documented in README):
//   1. `dependency` — `cold-backup` resolved from THIS package. The engine keeps its own repo,
//      CI and release flow; we only pin a version range. Single source of truth, no vendored copy.
//   2. `path`       — `cold-backup` on PATH. The pre-2.0 setup keeps working unchanged, and it is
//      what a machine with only the global CLI has.
//   3. `null`       — neither. The caller falls back to the generic file sources and says so.
//
// The engine is a bash script (macOS 3.2+ / Linux), so callers always run it as
// `/bin/bash <path> …` instead of relying on the executable bit or a shebang. That also gives
// dependency- and PATH-resolved copies one code path, and keeps WSL/Windows differences out of
// the picture: the package declares `os: darwin|linux`, and anything else is reported as
// unsupported rather than silently attempted.
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const ENGINE_PACKAGE = 'cold-backup'
export const ENGINE_BIN_RELATIVE = join('bin', 'cold-backup')

/** Platforms the engine package itself declares in its `os` field. */
function supportedPlatform(platform) {
  return platform === 'darwin' || platform === 'linux'
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the engine. Pure with respect to its inputs, so tests never touch a real install.
 *
 * @param {object} [options]
 * @param {NodeRequire} [options.require] resolver anchored at this package (injectable for tests)
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.platform]
 * @returns {{ path: string|null, source: 'dependency'|'path'|null, version: string|null,
 *             reason: 'unsupported-platform'|'missing-dependency'|'missing-binary'|null }}
 */
export function resolveEngine(options = {}) {
  const {
    require: requireFn = createRequire(import.meta.url),
    env = process.env,
    platform = process.platform,
  } = options

  if (!supportedPlatform(platform)) {
    return { path: null, source: null, version: null, reason: 'unsupported-platform' }
  }

  // 1. The dependency this package declares. A resolvable manifest whose binary is missing means
  //    a broken install (half-installed profile, pruned store) — worth telling apart from
  //    "not installed at all", because the two need different fixes.
  let dependencyBroken = false
  try {
    const manifestPath = requireFn.resolve(`${ENGINE_PACKAGE}/package.json`)
    const candidate = join(dirname(manifestPath), ENGINE_BIN_RELATIVE)
    if (isFile(candidate)) {
      let version = null
      try {
        version = JSON.parse(readFileSync(manifestPath, 'utf8'))?.version ?? null
      } catch {
        version = null
      }
      return { path: candidate, source: 'dependency', version, reason: null }
    }
    dependencyBroken = true
  } catch {
    // Not resolvable from here: the pre-2.0 setup (global CLI only), or a profile whose install
    // did not include the dependency.
  }

  // 2. PATH — the setup every existing user already has.
  for (const dir of String(env.PATH ?? '').split(':')) {
    if (!dir) continue
    const candidate = join(dir, ENGINE_PACKAGE)
    if (isFile(candidate)) return { path: candidate, source: 'path', version: null, reason: null }
  }

  return {
    path: null,
    source: null,
    version: null,
    reason: dependencyBroken ? 'missing-binary' : 'missing-dependency',
  }
}
