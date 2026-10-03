// Request trust for the **action** routes (`POST …/action`, `POST …/cancel`).
//
// The read route (`GET …/status`) stays open on purpose: it is read-only, it is what the panel
// polls every `refreshSeconds`, and it reveals nothing a local process could not read itself. The
// routes that *start* or *stop* work are the ones that need a decision, and this file is that
// decision — copied in spirit, and deliberately in the same order, from
// `dsh-archived/lib/host/trust.js`, which was hardened against a real failure:
//
//   The shipped web client is not the only client: the Desktop app talks to the same host, and a
//   request that reaches us through the app's own pipeline can arrive **without** the Fetch
//   Metadata headers a page-initiated fetch carries. Requiring `sec-fetch-site: same-origin`
//   outright therefore rejected the Desktop app's perfectly legitimate same-origin call.
//
// What actually has to hold is: loopback, not cross-site, and either the marker header or a proven
// same-origin signal:
//
//   * cross-site is always refused — that is the CSRF case, and every browser that matters sends
//     `sec-fetch-site` for it;
//   * `Origin`, when present, must match `Host` (browsers omit it on same-origin GETs, which is
//     why it cannot be required);
//   * a request with no signals at all needs the marker header, which a cross-origin page cannot
//     set without a preflight this server never approves.
//
// Threat model — see `docs/decisions.md` for the full argument: this defends against a *web page*
// reaching `127.0.0.1` and against accidents. It does not, and cannot, defend against a local
// process of the same user: that process can already run `cold-backup` itself, so these routes
// hand it nothing new. It also assumes the host listens on loopback only.

/** Marker a non-browser client (or the Desktop app's own pipeline) can set; cross-origin pages cannot. */
export const MARKER_HEADER = 'x-dsh-cold-backup'

/** Read one header as a string, tolerating the array form node uses for repeated headers. */
export function header(request, key) {
  const value = request?.headers?.[key]
  return Array.isArray(value) ? value[0] : value
}

export function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '')
  return (
    address === 'localhost' ||
    address === 'localhost.' ||
    address === '::1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.')
  )
}

/** Whether the request's `Origin` names this very host. */
function originMatchesHost(origin, host) {
  try {
    const url = new URL(origin)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackAddress(url.hostname) &&
      url.host === host
    )
  } catch {
    return false
  }
}

/**
 * The full trust decision, with the evidence that produced it.
 *
 * @returns `{ trusted, ... }` — the reasons are kept so a refused request can be reported instead
 * of vanishing, which is what made the equivalent Desktop-app failure invisible for a whole round
 * of debugging in the plugin this was learned from.
 */
export function trustReport(request) {
  const marker = header(request, MARKER_HEADER)
  const site = header(request, 'sec-fetch-site')
  const host = header(request, 'host')
  const origin = header(request, 'origin')
  const loopback = isLoopbackAddress(request?.socket?.remoteAddress)
  // A present Origin or Fetch Metadata signal is authoritative and cannot be overridden by the
  // marker: a mismatch is fatal on its own.
  const originOk = origin === undefined || originMatchesHost(origin, host)
  const siteOk = site === undefined || site === 'same-origin'
  // A same-origin signal is something a cross-origin page cannot produce, so it proves the caller
  // on its own. The marker covers the case where no Fetch Metadata header arrives at all (a
  // non-browser client, or the Desktop app's own request pipeline).
  const provenSameOrigin = (origin !== undefined && originOk) || site === 'same-origin'
  const trusted = loopback && Boolean(host) && originOk && siteOk && (marker === '1' || provenSameOrigin)
  return {
    trusted,
    marker: marker ?? null,
    loopback,
    host: host ?? null,
    site: site ?? null,
    origin: origin ?? null,
    originOk,
    siteOk,
    provenSameOrigin,
  }
}

export function isTrustedRequest(request) {
  return trustReport(request).trusted
}

/**
 * Short, operator-facing reason for a 403 — one line, no stack traces. The panel shows it, and a
 * silent refusal is what turned a legitimate caller away for a whole debugging round elsewhere.
 */
export function refusalReasons(report) {
  const reasons = []
  if (!report.loopback) reasons.push('not-loopback')
  if (!report.host) reasons.push('missing-host')
  if (!report.originOk) reasons.push('origin-mismatch')
  if (!report.siteOk) reasons.push('cross-site')
  if (!reasons.includes('cross-site') && !(report.marker === '1' || report.provenSameOrigin)) {
    reasons.push('missing-marker')
  }
  return reasons
}
