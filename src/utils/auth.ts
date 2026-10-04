// The auth playground: Basic, Bearer, API key and Digest, checked for real,
// with answers that say what was expected when a check fails.

import { NONCE_KEY } from './creds'
import { b64, b64Decode, dec, hmacHex, md5Hex, sha256Hex, hmac, hex, timingSafeEqual, randomHex, digestHex } from './crypto'
import { HubError } from '../http'

export const REALM = 'sondahub'

// ---------- Basic ----------

export function parseBasic(req: Request): { user: string; pass: string } | null {
  const h = req.headers.get('Authorization') ?? ''
  const m = /^Basic\s+(.+)$/i.exec(h.trim())
  if (!m) return null
  try {
    const raw = dec.decode(b64Decode(m[1].trim()))
    const i = raw.indexOf(':')
    if (i < 0) return { user: raw, pass: '' }
    return { user: raw.slice(0, i), pass: raw.slice(i + 1) }
  } catch {
    return null
  }
}

export function basicChallenge(message: string, hidden = false): HubError {
  if (hidden) return new HubError(404, 'not_found', 'Nothing here.')
  return new HubError(401, 'unauthorized', message, undefined, { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` })
}

// ---------- Bearer ----------

export function parseBearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

export function bearerChallenge(message: string, error = 'invalid_token'): HubError {
  return new HubError(401, 'unauthorized', message, undefined, { 'WWW-Authenticate': `Bearer realm="${REALM}", error="${error}", error_description="${message.replace(/"/g, "'")}"` })
}

// ---------- API key ----------

export function parseApiKey(req: Request, url: URL): { key: string; where: string } | null {
  const h = req.headers.get('X-API-Key')
  if (h) return { key: h.trim(), where: 'header X-API-Key' }
  const q = url.searchParams.get('api_key') ?? url.searchParams.get('apikey')
  if (q) return { key: q, where: 'query api_key' }
  const auth = req.headers.get('Authorization') ?? ''
  const m = /^(ApiKey|Api-Key)\s+(.+)$/i.exec(auth.trim())
  if (m) return { key: m[2].trim(), where: 'Authorization: ApiKey' }
  return null
}

// ---------- Digest (RFC 7616) ----------

export interface DigestParams {
  [k: string]: string
}

export function parseDigest(req: Request): DigestParams | null {
  const h = req.headers.get('Authorization') ?? ''
  if (!/^Digest\s/i.test(h.trim())) return null
  const out: DigestParams = {}
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g
  const body = h.trim().slice(6)
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]
  return out
}

async function nonce(): Promise<string> {
  const ts = String(Math.floor(Date.now() / 1000))
  const mac = await hmacHex(NONCE_KEY, ts)
  return b64(`${ts}:${mac.slice(0, 24)}`)
}

async function nonceAge(n: string): Promise<number | null> {
  try {
    const raw = dec.decode(b64Decode(n))
    const [ts, mac] = raw.split(':')
    const expect = (await hmacHex(NONCE_KEY, ts)).slice(0, 24)
    if (!timingSafeEqual(expect, mac ?? '')) return null
    return Math.floor(Date.now() / 1000) - parseInt(ts, 10)
  } catch {
    return null
  }
}

export async function digestChallenge(algorithm: string, qop: string, stale = false, message = 'Digest credentials are needed.'): Promise<HubError> {
  const n = await nonce()
  const parts = [`Digest realm="${REALM}"`, `qop="${qop}"`, `algorithm=${algorithm}`, `nonce="${n}"`, `opaque="${randomHex(8)}"`, 'charset=UTF-8']
  if (stale) parts.push('stale=true')
  return new HubError(401, 'unauthorized', message, undefined, { 'WWW-Authenticate': parts.join(', ') })
}

function H(algorithm: string): (s: string) => Promise<string> {
  const a = algorithm.toUpperCase()
  if (a.startsWith('SHA-256')) return (s) => sha256Hex(s)
  if (a.startsWith('SHA-512-256')) return async (s) => (await digestHex('SHA-512', s)).slice(0, 64)
  return async (s) => md5Hex(s)
}

export interface DigestCheck {
  ok: boolean
  reason?: string
  expected?: string
  stale?: boolean
  computed?: Record<string, string>
}

/** Verify a Digest Authorization header against user/pass for this request. */
export async function checkDigest(req: Request, url: URL, p: DigestParams, user: string, pass: string, body: string): Promise<DigestCheck> {
  if (p.username !== user) return { ok: false, reason: `username "${p.username}" is not "${user}"` }
  if (p.realm !== undefined && p.realm !== REALM) return { ok: false, reason: `realm "${p.realm}" is not "${REALM}"` }
  const age = await nonceAge(p.nonce ?? '')
  if (age === null) return { ok: false, reason: 'the nonce was not issued by this server', stale: true }
  if (age > 300) return { ok: false, reason: `the nonce is ${age} seconds old (limit 300)`, stale: true }
  const algorithm = p.algorithm ?? 'MD5'
  const h = H(algorithm)
  const sess = algorithm.toUpperCase().endsWith('-SESS')
  const uri = p.uri ?? ''
  const wanted = [url.pathname, url.pathname + url.search]
  if (!wanted.includes(uri)) return { ok: false, reason: `uri "${uri}" does not match the request (${url.pathname + url.search})` }
  let ha1 = await h(`${user}:${REALM}:${pass}`)
  if (sess) ha1 = await h(`${ha1}:${p.nonce}:${p.cnonce ?? ''}`)
  const qop = (p.qop ?? '').toLowerCase()
  const method = req.method.toUpperCase()
  const ha2 = qop === 'auth-int' ? await h(`${method}:${uri}:${await h(body)}`) : await h(`${method}:${uri}`)
  let expected: string
  if (qop === 'auth' || qop === 'auth-int') {
    if (!p.nc || !p.cnonce) return { ok: false, reason: 'qop is set but nc or cnonce is missing' }
    expected = await h(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${qop}:${ha2}`)
  } else if (!qop) {
    expected = await h(`${ha1}:${p.nonce}:${ha2}`)
  } else {
    return { ok: false, reason: `qop "${p.qop}" is not auth or auth-int` }
  }
  const computed = { algorithm, qop: qop || '(none, RFC 2069)', ha1: sess ? '(session)' : ha1, ha2, expected }
  if (!timingSafeEqual(expected, (p.response ?? '').toLowerCase())) return { ok: false, reason: 'the response hash does not match', expected, computed }
  return { ok: true, computed }
}
