// What happens around every API answer: another format when the client
// asks for one, and problem details for errors when the client prefers them.
//
//   Accept: text/csv | application/xml | application/yaml | application/x-ndjson | application/msgpack   (or ?format=)
//   Accept: application/problem+json                                            (or ?_errors=problem)

import { Format, wantedFormat, render, CONTENT_TYPES } from './formats'
import { APIS } from './registry'
import { upgradeOf } from './ws'

export interface Controls {
  format: Format | null
  problem: boolean
}

export function controls(req: Request, url: URL): Controls {
  const accept = (req.headers.get('Accept') ?? '').toLowerCase()
  return {
    format: req.method === 'GET' || req.method === 'HEAD' ? wantedFormat(req, url) : null,
    problem: accept.includes('application/problem+json') || url.searchParams.get('_errors') === 'problem',
  }
}

export function problemType(base: string, code: string): string {
  return `${base}/v1/problems/${code}`
}

/** Collection names for XML: /v1/{api}/{collection}[/{id}[/{relation}]]. */
function xmlNames(path: string): { plural: string; singular: string } | undefined {
  const seg = path.split('/').filter(Boolean)
  if (seg[0] !== 'v1' || seg.length < 3) return undefined
  const api = APIS.find((a) => a.name === seg[1])
  let c = api?.collections.find((x) => x.name === seg[2])
  if (api && c && seg.length >= 5) {
    const rel = c.relations?.find((r) => r.name === seg[4])
    c = rel ? api.collections.find((x) => x.name === rel.collection) : c
  }
  return c ? { plural: c.name, singular: c.singular } : undefined
}

export async function finish(res: Response, req: Request, url: URL, base: string, c: Controls): Promise<Response> {
  // a socket being opened is answered as it is
  if (upgradeOf(res)) return res
  const ct = res.headers.get('Content-Type') ?? ''
  const isJson = ct.includes('json') && !ct.includes('event-stream')
  if (!isJson || (!(c.format && res.status === 200) && !(c.problem && res.status >= 400))) return res

  const headers = new Headers(res.headers)
  const text = await res.text()
  let body: string | Uint8Array = text

  if (c.format && res.status === 200) {
    try {
      body = render(c.format, JSON.parse(text), xmlNames(url.pathname))
      headers.set('Content-Type', CONTENT_TYPES[c.format])
      headers.delete('ETag')
    } catch {
      /* leave it JSON */
    }
  }

  if (c.problem && res.status >= 400) {
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } }
      if (parsed.error?.code) {
        const p: Record<string, unknown> = { type: problemType(base, parsed.error.code), title: parsed.error.code.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase()), status: res.status, detail: parsed.error.message, instance: url.pathname }
        if (parsed.error.details !== undefined) p.errors = parsed.error.details
        body = JSON.stringify(p, null, 2)
        headers.set('Content-Type', 'application/problem+json; charset=utf-8')
      }
    } catch {
      /* not the server's error shape */
    }
  }

  headers.delete('Content-Length')
  return new Response(req.method === 'HEAD' ? null : (body as BodyInit), { status: res.status, statusText: res.statusText, headers })
}
