import { APP_VERSION } from './version'
import { hash53 } from './gen/prng'

export class HubError extends Error {
  status: number
  code: string
  details?: unknown
  headers?: Record<string, string>
  constructor(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

export function baseHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers(CORS_HEADERS)
  h.set('X-Sondahub-Version', APP_VERSION)
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v)
  return h
}

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const h = baseHeaders(extra)
  h.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data, null, 2), { status, headers: h })
}

export function text(body: string, status = 200, extra?: Record<string, string>): Response {
  const h = baseHeaders(extra)
  if (!h.has('Content-Type')) h.set('Content-Type', 'text/plain; charset=utf-8')
  return new Response(body, { status, headers: h })
}

export function html(body: string, status = 200, extra?: Record<string, string>): Response {
  return text(body, status, { 'Content-Type': 'text/html; charset=utf-8', ...(extra ?? {}) })
}

export function empty(status = 204, extra?: Record<string, string>): Response {
  return new Response(null, { status, headers: baseHeaders(extra) })
}

export function errorResponse(e: HubError): Response {
  const body: Record<string, unknown> = { error: { code: e.code, message: e.message } }
  if (e.details !== undefined) (body.error as Record<string, unknown>).details = e.details
  return json(body, e.status, e.headers)
}

export function notFound(message = 'No such route.'): HubError {
  return new HubError(404, 'not_found', message)
}

export function badRequest(message: string, details?: unknown): HubError {
  return new HubError(400, 'bad_request', message, details)
}

/** A weak ETag for a JSON body; answers 304 when the client already has it. */
export function withEtag(req: Request, data: unknown, status = 200, extra?: Record<string, string>): Response {
  const body = JSON.stringify(data, null, 2)
  const tag = `W/"${hash53(body).toString(16)}-${body.length.toString(16)}"`
  const inm = req.headers.get('If-None-Match')
  const h = baseHeaders(extra)
  h.set('ETag', tag)
  if (inm && inm.split(',').some((t) => t.trim() === tag)) {
    return new Response(null, { status: 304, headers: h })
  }
  h.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(body, { status, headers: h })
}

/** A body that is over the cap: told by Content-Length, or found while reading (chunked bodies have none). */
export class BodyTooLarge extends Error {
  constructor(public max: number) {
    super(`The body is over ${max} bytes.`)
  }
}

/**
 * The body as text, read no further than maxBytes: a Content-Length over the
 * cap is refused before reading, and a body without one is read in chunks
 * and dropped the moment it passes the cap — so no request holds more than
 * that in memory.
 */
export async function readCapped(req: Request, maxBytes: number): Promise<string> {
  const len = Number(req.headers.get('Content-Length') ?? '')
  if (Number.isFinite(len) && len > maxBytes) throw new BodyTooLarge(maxBytes)
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLarge(maxBytes)
    }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  let raw: string
  try {
    raw = await readCapped(req, maxBytes)
  } catch (e) {
    if (e instanceof BodyTooLarge) throw new HubError(413, 'payload_too_large', `Bodies are capped at ${maxBytes} bytes.`)
    throw e
  }
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HubError(400, 'invalid_json', 'The body is not valid JSON.')
  }
}

/** The first address in X-Forwarded-For: the server adds the connection's own address when a proxy has not. */
export function clientIp(req: Request): string {
  return req.headers.get('X-Forwarded-For')?.split(',')[0].trim() || '0.0.0.0'
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}
