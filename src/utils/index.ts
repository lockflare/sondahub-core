// The utilities API: HTTP test endpoints for API clients — echo, status
// codes, delays, redirects, cookies, bodies and encodings, streams, uploads
// — and the common auth schemes, checked for real. Nothing here touches the
// data.

import { publicOrigin } from '../env'
import { HubError, json, text, html, empty, notFound, readJson, baseHeaders, clientIp, nowIso } from '../http'
import { CREDS } from './creds'
import { parseBasic, basicChallenge, parseBearer, bearerChallenge, parseApiKey, parseDigest, digestChallenge, checkDigest } from './auth'
import { b64, b64Decode, b64url, dec, digestHex, md5Hex, sha256Hex, crc32, randomHex } from './crypto'
import { echoSocket } from '../live'
import { UTIL_GROUPS } from './catalog'

export interface UtilsArgs {
  req: Request
  url: URL
  rest: string[]
}

const MAX_DELAY_S = 10
const MAX_BYTES = 1_000_000

export async function handleUtils(a: UtilsArgs): Promise<Response> {
  const { req, url, rest } = a
  const method = req.method.toUpperCase()
  const base = publicOrigin(url)
  const [head, ...tail] = rest

  switch (head) {
    case undefined:
      return index(base)

    // ---------- request inspection ----------
    case 'echo':
    case 'anything':
      return echo(a)
    case 'get':
      if (method !== 'GET') throw methodNot(method, 'GET')
      return echo(a)
    case 'post':
      if (method !== 'POST') throw methodNot(method, 'POST')
      return echo(a)
    case 'put':
      if (method !== 'PUT') throw methodNot(method, 'PUT')
      return echo(a)
    case 'patch':
      if (method !== 'PATCH') throw methodNot(method, 'PATCH')
      return echo(a)
    case 'delete':
      if (method !== 'DELETE') throw methodNot(method, 'DELETE')
      return echo(a)
    case 'headers': {
      const h: Record<string, string> = {}
      req.headers.forEach((v, k) => (h[k] = v))
      return json({ headers: h })
    }
    case 'ip':
      return json({ ip: clientIp(req) })
    case 'user-agent':
      return json({ 'user-agent': req.headers.get('User-Agent') ?? null })
    case 'time': {
      const d = new Date()
      return json({ iso: d.toISOString(), unix: Math.floor(d.getTime() / 1000), unix_ms: d.getTime(), rfc2822: d.toUTCString(), date: d.toISOString().slice(0, 10), timezone: 'UTC' })
    }
    case 'uuid':
      return json({ uuid: crypto.randomUUID() })

    // ---------- status and delays ----------
    case 'status': {
      const codes = (tail[0] ?? '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 100 && n <= 599)
      if (!codes.length) throw new HubError(400, 'bad_status', 'Use /status/{code}, 100–599, or a comma list to pick one at random (/status/200,500).')
      const code = codes[Math.floor(Math.random() * codes.length)]
      const h: Record<string, string> = {}
      if (code >= 300 && code < 400 && code !== 304) h.Location = `${base}/v1/utils/get`
      if (code === 401) h['WWW-Authenticate'] = 'Basic realm="sondahub"'
      if (code === 429 || code === 503) h['Retry-After'] = '5'
      if (code === 204 || code === 304 || code < 200) return new Response(null, { status: code, headers: baseHeaders(h) })
      return json({ status: code, message: STATUS_TEXT[code] ?? 'status ' + code, from: codes.length > 1 ? codes : undefined }, code, h)
    }
    case 'delay': {
      const s = Math.min(MAX_DELAY_S, Math.max(0, parseFloat(tail[0] ?? '1') || 0))
      await sleep(s * 1000)
      return json({ delayed_seconds: s, method, url: url.pathname + url.search, received_at: nowIso() })
    }

    // ---------- redirects ----------
    case 'redirect':
    case 'relative-redirect':
    case 'absolute-redirect': {
      const n = Math.min(20, Math.max(1, parseInt(tail[0] ?? '1', 10) || 1))
      const next = n > 1 ? `/v1/utils/${head}/${n - 1}` : '/v1/utils/get'
      const loc = head === 'relative-redirect' ? next : `${base}${next}`
      return new Response(null, { status: 302, headers: baseHeaders({ Location: loc }) })
    }
    case 'redirect-to': {
      const to = url.searchParams.get('url') ?? ''
      const status = parseInt(url.searchParams.get('status') ?? '302', 10)
      if (!to) throw new HubError(400, 'bad_request', 'Give ?url= (a path on this host, or an absolute URL on this host) and optionally ?status=301|302|303|307|308.')
      let target: URL
      try {
        target = new URL(to, base)
      } catch {
        throw new HubError(400, 'bad_request', `"${to}" is not a URL.`)
      }
      const allowed = new URL(base).host
      if (target.host !== allowed && target.host !== url.host) throw new HubError(400, 'bad_request', `Redirects only go to this host (${allowed}), never elsewhere.`)
      if (![301, 302, 303, 307, 308].includes(status)) throw new HubError(400, 'bad_request', 'status must be 301, 302, 303, 307 or 308.')
      return new Response(null, { status, headers: baseHeaders({ Location: target.toString() }) })
    }

    // ---------- cookies ----------
    case 'cookies': {
      const jar = parseCookies(req)
      if (!tail.length) return json({ cookies: jar })
      if (tail[0] === 'set') {
        const h = baseHeaders({ Location: `${base}/v1/utils/cookies` })
        if (tail.length === 3) h.append('Set-Cookie', cookie(tail[1], tail[2], url))
        else for (const [k, v] of url.searchParams.entries()) if (k !== 'key') h.append('Set-Cookie', cookie(k, v, url))
        return new Response(null, { status: 302, headers: h })
      }
      if (tail[0] === 'delete') {
        const h = baseHeaders({ Location: `${base}/v1/utils/cookies` })
        const names = tail.length === 2 ? [tail[1]] : [...url.searchParams.keys()].filter((k) => k !== 'key')
        for (const k of names) h.append('Set-Cookie', `${k}=; Path=/; Max-Age=0`)
        return new Response(null, { status: 302, headers: h })
      }
      throw notFound('Cookie routes: /cookies, /cookies/set?name=value, /cookies/set/{name}/{value}, /cookies/delete?name.')
    }

    // ---------- bodies and encodings ----------
    case 'json':
      return json(SAMPLE_JSON)
    case 'xml':
      return text(SAMPLE_XML, 200, { 'Content-Type': 'application/xml; charset=utf-8' })
    case 'html':
      return html(SAMPLE_HTML)
    case 'robots.txt':
      return text('User-agent: *\nDisallow: /v1/utils/deny\n')
    case 'deny':
      return text("You've been denied, as robots.txt said you would be.\n", 403)
    case 'encoding': {
      if (tail[0] === 'utf8') return text('UTF-8 all the way: ñandú, façade, naïve, Zürich, 東京, Москва, العربية, 🚀 ✓ — and a tab\there.\n')
      throw notFound()
    }
    case 'gzip':
    case 'deflate': {
      const payload = JSON.stringify({ [head + 'ed']: true, method, headers: headersObject(req), origin: clientIp(req), note: `The body came ${head}-compressed with Content-Encoding: ${head}.` }, null, 2)
      const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream(head as 'gzip' | 'deflate'))
      const buf = await new Response(stream).arrayBuffer()
      return new Response(buf, { status: 200, headers: baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': head, 'Content-Length': String(buf.byteLength) }) })
    }
    case 'bytes': {
      const n = Math.min(MAX_BYTES, Math.max(0, parseInt(tail[0] ?? '32', 10) || 0))
      const bytes = randomBytes(n, url.searchParams.get('seed'))
      return new Response(bytes as unknown as BodyInit, { status: 200, headers: baseHeaders({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(n) }) })
    }
    case 'range': {
      const n = Math.min(MAX_BYTES, Math.max(0, parseInt(tail[0] ?? '1024', 10) || 0))
      const all = new Uint8Array(n)
      for (let i = 0; i < n; i++) all[i] = 97 + (i % 26)
      const range = req.headers.get('Range')
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : Math.max(0, n - parseInt(m[2], 10))
        let end = m[1] && m[2] ? parseInt(m[2], 10) : n - 1
        if (!m[1]) end = n - 1
        if (start >= n || start > end) return new Response(null, { status: 416, headers: baseHeaders({ 'Content-Range': `bytes */${n}` }) })
        end = Math.min(end, n - 1)
        return new Response(all.slice(start, end + 1), { status: 206, headers: baseHeaders({ 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${n}`, 'Content-Length': String(end - start + 1) }) })
      }
      return new Response(all, { status: 200, headers: baseHeaders({ 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': String(n) }) })
    }
    case 'big': {
      const rows = Math.min(20000, Math.max(1, parseInt(url.searchParams.get('rows') ?? '5000', 10) || 1))
      const out: unknown[] = []
      for (let i = 1; i <= rows; i++) out.push({ id: i, name: `Row ${i}`, value: Math.round(Math.sin(i) * 10000) / 100, flag: i % 3 === 0, tags: ['a', 'b'].slice(0, (i % 2) + 1), nested: { x: i * 2, y: `y${i}` } })
      return json({ rows, data: out })
    }
    case 'stream': {
      const n = Math.min(500, Math.max(1, parseInt(tail[0] ?? '10', 10) || 1))
      const interval = Math.min(2000, Math.max(0, parseInt(url.searchParams.get('interval') ?? '100', 10) || 0))
      const enc = new TextEncoder()
      const body = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < n; i++) {
            controller.enqueue(enc.encode(JSON.stringify({ id: i, at: nowIso(), of: n }) + '\n'))
            if (interval) await sleep(interval)
          }
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: baseHeaders({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }) })
    }
    case 'stream-bytes': {
      const n = Math.min(MAX_BYTES, Math.max(0, parseInt(tail[0] ?? '1024', 10) || 0))
      const chunk = Math.min(65536, Math.max(1, parseInt(url.searchParams.get('chunk') ?? '1024', 10) || 1))
      const body = new ReadableStream({
        async start(controller) {
          let sent = 0
          while (sent < n) {
            const size = Math.min(chunk, n - sent)
            controller.enqueue(randomBytes(size, null))
            sent += size
            await sleep(10)
          }
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: baseHeaders({ 'Content-Type': 'application/octet-stream' }) })
    }
    case 'drip': {
      const numbytes = Math.min(MAX_BYTES, Math.max(1, parseInt(url.searchParams.get('numbytes') ?? '10', 10) || 1))
      const duration = Math.min(MAX_DELAY_S, Math.max(0, parseFloat(url.searchParams.get('duration') ?? '2') || 0))
      const delay = Math.min(MAX_DELAY_S, Math.max(0, parseFloat(url.searchParams.get('delay') ?? '0') || 0))
      const code = parseInt(url.searchParams.get('code') ?? '200', 10) || 200
      await sleep(delay * 1000)
      const pause = numbytes > 1 ? (duration * 1000) / (numbytes - 1) : 0
      const body = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < numbytes; i++) {
            controller.enqueue(new Uint8Array([42]))
            if (i < numbytes - 1 && pause) await sleep(pause)
          }
          controller.close()
        },
      })
      return new Response(body, { status: code, headers: baseHeaders({ 'Content-Type': 'application/octet-stream' }) })
    }
    case 'sse':
    case 'events':
      return sseClock(a)
    case 'image': {
      const kind = tail[0] ?? accepts(req)
      if (kind === 'svg') return new Response(svgImage(url), { status: 200, headers: baseHeaders({ 'Content-Type': 'image/svg+xml' }) })
      if (kind === 'png') return new Response((await pngImage(url)) as unknown as BodyInit, { status: 200, headers: baseHeaders({ 'Content-Type': 'image/png' }) })
      throw new HubError(406, 'not_acceptable', 'The server draws svg and png: /image/svg, /image/png (?w=&h=&color=&text=), or send an Accept header naming one.')
    }
    case 'base64': {
      if (method === 'POST') {
        const raw = new Uint8Array(await req.arrayBuffer())
        return json({ base64: b64(raw), base64url: b64url(raw), bytes: raw.byteLength })
      }
      const v = tail.join('/')
      if (!v) throw new HubError(400, 'bad_request', 'GET /base64/{value} decodes; POST /base64 with a body encodes.')
      try {
        const bytes = b64Decode(v.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (v.length % 4)) % 4))
        return text(dec.decode(bytes))
      } catch {
        throw new HubError(400, 'bad_request', 'That is not valid base64.')
      }
    }
    case 'hash': {
      const algo = (tail[0] ?? 'sha256').toLowerCase()
      const input = method === 'POST' ? new Uint8Array(await req.arrayBuffer()) : new TextEncoder().encode(url.searchParams.get('text') ?? '')
      let out: string
      if (algo === 'md5') out = md5Hex(input)
      else if (algo === 'sha1') out = await digestHex('SHA-1', input)
      else if (algo === 'sha256') out = await sha256Hex(input)
      else if (algo === 'sha384') out = await digestHex('SHA-384', input)
      else if (algo === 'sha512') out = await digestHex('SHA-512', input)
      else if (algo === 'crc32') out = crc32(input).toString(16).padStart(8, '0')
      else throw new HubError(400, 'bad_request', 'Algorithms: md5, sha1, sha256, sha384, sha512, crc32. GET ?text= or POST the bytes.')
      return json({ algorithm: algo, bytes: input.byteLength, hex: out })
    }

    // ---------- caching ----------
    case 'cache': {
      if (tail[0] !== undefined) {
        const s = Math.max(0, parseInt(tail[0], 10) || 0)
        return json({ cache_control: `public, max-age=${s}`, served_at: nowIso() }, 200, { 'Cache-Control': `public, max-age=${s}` })
      }
      const tag = '"sondahub-cache-v1"'
      const lastMod = 'Wed, 01 Jan 2025 00:00:00 GMT'
      const inm = req.headers.get('If-None-Match')
      const ims = req.headers.get('If-Modified-Since')
      if ((inm && inm.split(',').some((t) => t.trim() === tag)) || (ims && !Number.isNaN(Date.parse(ims)) && Date.parse(ims) >= Date.parse(lastMod))) {
        return new Response(null, { status: 304, headers: baseHeaders({ ETag: tag, 'Last-Modified': lastMod }) })
      }
      return json({ etag: tag, last_modified: lastMod, note: 'Send If-None-Match or If-Modified-Since to get a 304.' }, 200, { ETag: tag, 'Last-Modified': lastMod, 'Cache-Control': 'public, max-age=60' })
    }
    case 'etag': {
      const tag = `"${tail[0] ?? 'default'}"`
      const inm = req.headers.get('If-None-Match')
      const im = req.headers.get('If-Match')
      if (im && im !== '*' && !im.split(',').some((t) => t.trim() === tag)) return json({ error: { code: 'precondition_failed', message: `If-Match ${im} does not match ${tag}.` } }, 412, { ETag: tag })
      if (inm && (inm === '*' || inm.split(',').some((t) => t.trim() === tag))) return new Response(null, { status: 304, headers: baseHeaders({ ETag: tag }) })
      return json({ etag: tag }, 200, { ETag: tag })
    }
    case 'response-headers': {
      const h: Record<string, string> = {}
      for (const [k, v] of url.searchParams.entries()) if (k !== 'key' && /^[A-Za-z0-9-]+$/.test(k) && !/^(content-length|transfer-encoding|content-encoding)$/i.test(k)) h[k] = v
      return json({ headers: h }, 200, h)
    }

    // ---------- forms and uploads ----------
    case 'forms':
    case 'upload':
      return formPost(a)

    // ---------- auth ----------
    case 'auth':
      return auth(a, tail)

    // ---------- sockets ----------
    case 'ws':
      if (tail.length) throw notFound('The WebSocket utility is /v1/utils/ws: an echo.')
      return echoSocket(req, url)

    default:
      throw notFound(`No utility called "${head}". GET /v1/utils lists them.`)
  }
}

// ---------- pieces ----------

function methodNot(method: string, want: string): HubError {
  return new HubError(405, 'method_not_allowed', `This route answers ${want} only; you sent ${method}.`, undefined, { Allow: `${want}, OPTIONS` })
}

function headersObject(req: Request): Record<string, string> {
  const h: Record<string, string> = {}
  req.headers.forEach((v, k) => (h[k] = v))
  return h
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function echo(a: UtilsArgs): Promise<Response> {
  const { req, url } = a
  const query: Record<string, string | string[]> = {}
  for (const [k, v] of url.searchParams.entries()) {
    const prev = query[k]
    if (prev === undefined) query[k] = v
    else query[k] = Array.isArray(prev) ? [...prev, v] : [prev, v]
  }
  const ct = req.headers.get('Content-Type') ?? ''
  let body: unknown = null
  let form: Record<string, unknown> | null = null
  let files: unknown[] | null = null
  let bytes = 0
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const fd = await req.formData().catch(() => null)
      if (fd) {
        form = {}
        files = []
        for (const [k, v] of fd.entries()) {
          if (typeof v === 'string') form[k] = k in form ? [form[k], v].flat() : v
          else files.push({ field: k, name: v.name, size: v.size, content_type: v.type || null, sha256: await sha256Hex(new Uint8Array(await v.arrayBuffer())) })
        }
      }
    } else {
      const raw = new Uint8Array(await req.arrayBuffer())
      bytes = raw.byteLength
      if (raw.byteLength > MAX_BYTES) throw new HubError(413, 'payload_too_large', `Bodies are capped at ${MAX_BYTES} bytes.`)
      if (ct.includes('json')) {
        try {
          body = JSON.parse(dec.decode(raw))
        } catch {
          body = { _invalid_json: dec.decode(raw) }
        }
      } else if (ct.startsWith('text/') || ct.includes('xml') || ct.includes('javascript') || !ct) {
        body = dec.decode(raw)
      } else {
        body = { _binary_base64: b64(raw), bytes: raw.byteLength }
      }
    }
  }
  return json({
    method: req.method,
    url: url.toString().replace(/([?&])key=[^&]*/, '$1key=…'),
    path: url.pathname,
    query,
    headers: headersObject(req),
    content_type: ct || null,
    content_length: bytes,
    body,
    form,
    files,
    origin: clientIp(req),
    received_at: nowIso(),
  })
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.get('Cookie') ?? ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function cookie(name: string, value: string, url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=86400; SameSite=Lax${secure}`
}

function randomBytes(n: number, seed: string | null): Uint8Array {
  const out = new Uint8Array(n)
  if (seed) {
    let x = 0
    for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      out[i] = x >>> 24
    }
  } else {
    for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)))
  }
  return out
}

function accepts(req: Request): string {
  const a = (req.headers.get('Accept') ?? '').toLowerCase()
  if (a.includes('image/svg')) return 'svg'
  if (a.includes('image/png') || a.includes('image/*') || a.includes('*/*')) return 'png'
  return 'none'
}

function svgImage(url: URL): string {
  const w = Math.min(2000, Math.max(16, parseInt(url.searchParams.get('w') ?? '320', 10) || 320))
  const h = Math.min(2000, Math.max(16, parseInt(url.searchParams.get('h') ?? '200', 10) || 200))
  const color = /^[0-9a-fA-F]{6}$/.test(url.searchParams.get('color') ?? '') ? '#' + url.searchParams.get('color') : '#f47a20'
  const label = (url.searchParams.get('text') ?? `${w}×${h}`).slice(0, 40).replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${Math.min(24, w / 10)}" fill="${color}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="${Math.max(12, Math.min(w, h) / 6)}" fill="#fff">${label}</text></svg>`
}

export async function pngImage(url: URL): Promise<Uint8Array> {
  const w = Math.min(512, Math.max(1, parseInt(url.searchParams.get('w') ?? '160', 10) || 160))
  const h = Math.min(512, Math.max(1, parseInt(url.searchParams.get('h') ?? '100', 10) || 100))
  const c = /^[0-9a-fA-F]{6}$/.test(url.searchParams.get('color') ?? '') ? url.searchParams.get('color')! : 'f47a20'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2
      const i = row + 1 + x * 3
      raw[i] = edge ? 255 : r
      raw[i + 1] = edge ? 255 : g
      raw[i + 2] = edge ? 255 : b
    }
  }
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const chunks: Uint8Array[] = []
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type)
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, data.length)
    const body = new Uint8Array(t.length + data.length)
    body.set(t)
    body.set(data, t.length)
    const crc = new Uint8Array(4)
    new DataView(crc.buffer).setUint32(0, crc32(body))
    chunks.push(len, body, crc)
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 2
  chunk('IHDR', ihdr)
  chunk('IDAT', deflated)
  chunk('IEND', new Uint8Array(0))
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const total = sig.length + chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  out.set(sig)
  let off = sig.length
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function sseClock(a: UtilsArgs): Response {
  const { url, req } = a
  const count = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('count') ?? '10', 10) || 10))
  const interval = Math.min(10000, Math.max(50, parseInt(url.searchParams.get('interval') ?? '1000', 10) || 1000))
  const last = parseInt(req.headers.get('Last-Event-ID') ?? url.searchParams.get('last') ?? '0', 10) || 0
  const enc = new TextEncoder()
  let closed = false
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(`retry: 3000\n: sondahub clock — ${count} ticks every ${interval} ms${last ? `, resuming after ${last}` : ''}\n\n`))
      for (let i = last + 1; i <= last + count && !closed; i++) {
        const d = new Date()
        controller.enqueue(enc.encode(`id: ${i}\nevent: tick\ndata: ${JSON.stringify({ n: i, of: last + count, iso: d.toISOString(), unix_ms: d.getTime() })}\n\n`))
        if (i % 5 === 0) controller.enqueue(enc.encode(`event: note\ndata: {"message":"tick ${i} — a different event name, so a client can tell them apart"}\n\n`))
        await sleep(interval)
      }
      if (!closed) {
        controller.enqueue(enc.encode(`event: done\ndata: {"sent":${count}}\n\n`))
        controller.close()
      }
    },
    cancel() {
      closed = true
    },
  })
  return new Response(body, { status: 200, headers: baseHeaders({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }) })
}

async function formPost(a: UtilsArgs): Promise<Response> {
  const { req } = a
  if (req.method !== 'POST' && req.method !== 'PUT') throw methodNot(req.method, 'POST')
  const ct = req.headers.get('Content-Type') ?? ''
  if (!ct.includes('multipart/form-data') && !ct.includes('application/x-www-form-urlencoded')) {
    throw new HubError(415, 'unsupported_media_type', 'Send multipart/form-data or application/x-www-form-urlencoded. For JSON use /v1/utils/echo.')
  }
  const fd = await req.formData().catch(() => null)
  if (!fd) throw new HubError(400, 'bad_request', 'The form could not be read.')
  const fields: Record<string, unknown> = {}
  const files: unknown[] = []
  let total = 0
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') fields[k] = k in fields ? [fields[k], v].flat() : v
    else {
      const bytes = new Uint8Array(await v.arrayBuffer())
      total += bytes.byteLength
      if (total > MAX_BYTES) throw new HubError(413, 'payload_too_large', `Uploads are capped at ${MAX_BYTES} bytes in all.`)
      files.push({ field: k, filename: v.name, size: bytes.byteLength, content_type: v.type || null, sha256: await sha256Hex(bytes), md5: md5Hex(bytes), head_base64: b64(bytes.slice(0, 32)) })
    }
  }
  return json({ received: true, content_type: ct, fields, files, total_file_bytes: total })
}

// ---------- auth routes ----------

async function auth(a: UtilsArgs, tail: string[]): Promise<Response> {
  const { req, url } = a
  const scheme = tail[0]
  switch (scheme) {
    case 'basic':
    case 'hidden-basic': {
      const user = tail[1] ?? CREDS.username
      const pass = tail[2] ?? CREDS.password
      const hidden = scheme === 'hidden-basic'
      const given = parseBasic(req)
      if (!given) throw basicChallenge(`Basic credentials are needed. Try ${user} / ${pass}.`, hidden)
      if (given.user !== user || given.pass !== pass) throw basicChallenge(`Wrong credentials for ${given.user}. This route wants ${user} / ${pass}.`, hidden)
      return json({ authenticated: true, scheme: 'basic', user: given.user })
    }
    case 'bearer': {
      const want = tail[1] ?? null
      const t = parseBearer(req)
      if (!t) throw bearerChallenge(want ? `Send Authorization: Bearer ${want}.` : 'Send Authorization: Bearer <any token>.', 'invalid_request')
      if (want && t !== want) throw bearerChallenge(`Token "${t}" is not the one this route wants (${want}).`)
      return json({ authenticated: true, scheme: 'bearer', token: t })
    }
    case 'apikey': {
      const want = tail[1] ?? CREDS.apiKey
      const k = parseApiKey(req, url)
      if (!k) throw new HubError(401, 'unauthorized', `Send the key as X-API-Key: ${want} (or ?api_key=${want}, or Authorization: ApiKey ${want}).`)
      if (k.key !== want) throw new HubError(403, 'forbidden', `Key "${k.key}" (from ${k.where}) is not accepted; this route wants ${want}.`)
      return json({ authenticated: true, scheme: 'apikey', key: k.key, found_in: k.where })
    }
    case 'digest': {
      const user = tail[1] ?? CREDS.username
      const pass = tail[2] ?? CREDS.password
      const algorithm = url.searchParams.get('algorithm') ?? 'MD5'
      const qop = url.searchParams.get('qop') ?? 'auth'
      if (!/^(MD5|MD5-sess|SHA-256|SHA-256-sess|SHA-512-256|SHA-512-256-sess)$/i.test(algorithm)) throw new HubError(400, 'bad_request', 'algorithm must be MD5, MD5-sess, SHA-256, SHA-256-sess, SHA-512-256 or SHA-512-256-sess.')
      if (!/^(auth|auth-int|auth,auth-int)$/.test(qop)) throw new HubError(400, 'bad_request', 'qop must be auth, auth-int, or auth,auth-int.')
      const p = parseDigest(req)
      if (!p) throw await digestChallenge(algorithm, qop, false, `Digest credentials are needed. Try ${user} / ${pass}.`)
      const body = ['GET', 'HEAD'].includes(req.method) ? '' : await req.text()
      const r = await checkDigest(req, url, p, user, pass, body)
      if (!r.ok) {
        if (r.stale) throw await digestChallenge(algorithm, qop, true, `Stale: ${r.reason}. A fresh nonce is in WWW-Authenticate.`)
        throw new HubError(401, 'unauthorized', `Digest check failed: ${r.reason}.`, r.computed, { 'WWW-Authenticate': (await digestChallenge(algorithm, qop)).headers!['WWW-Authenticate'] })
      }
      return json({ authenticated: true, scheme: 'digest', user, algorithm: r.computed?.algorithm, qop: r.computed?.qop })
    }
    case undefined:
      return json({
        basic: { url: `/v1/utils/auth/basic`, or: `/v1/utils/auth/basic/{user}/{pass}`, user: CREDS.username, pass: CREDS.password },
        hidden_basic: { url: `/v1/utils/auth/hidden-basic/{user}/{pass}`, note: 'answers 404 instead of 401' },
        bearer: { url: `/v1/utils/auth/bearer`, or: `/v1/utils/auth/bearer/{token}`, note: 'any non-empty token, or exactly {token}' },
        apikey: { url: `/v1/utils/auth/apikey`, key: CREDS.apiKey, where: 'X-API-Key header, ?api_key=, or Authorization: ApiKey' },
        digest: { url: `/v1/utils/auth/digest`, or: `/v1/utils/auth/digest/{user}/{pass}?algorithm=SHA-256&qop=auth-int`, user: CREDS.username, pass: CREDS.password },
      })
    default:
      throw notFound(`No auth scheme "${scheme}". Schemes: basic, hidden-basic, bearer, apikey, digest.`)
  }
}

function index(base: string): Response {
  return json({
    name: 'utils',
    description: 'HTTP test endpoints for API clients: echo, status codes, delays, redirects, cookies, compression, streams and uploads, plus Basic, Digest, API key and Bearer auth.',
    credentials: { username: CREDS.username, password: CREDS.password, api_key: CREDS.apiKey },
    groups: UTIL_GROUPS.map((g) => ({
      name: g.name,
      description: g.doc,
      endpoints: g.entries.map((e) => ({ method: e.method, url: e.method === 'WS' ? `${base.replace(/^http/, 'ws')}${e.path}` : `${base}${e.path}`, description: e.doc, ...(e.hint ? { content_type: e.hint } : {}) })),
    })),
  })
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 206: 'Partial Content',
  300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 412: 'Precondition Failed', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 418: "I'm a teapot", 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}

const SAMPLE_JSON = {
  slideshow: {
    author: 'sondahub',
    date: '2026-09-30',
    title: 'Sample slide show',
    slides: [
      { title: 'Wake up to APIs', type: 'all' },
      { title: 'Overview', type: 'all', items: ['Why the hub exists', 'Who it is for', 'What it answers'] },
    ],
  },
  numbers: [1, 2.5, -3, 1e21, 0],
  nested: { deep: { deeper: { deepest: true } } },
  unicode: 'ñandú ✓ 東京',
  nothing: null,
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<slideshow title="Sample slide show" date="2026-09-30" author="sondahub">
  <slide type="all"><title>Wake up to APIs</title></slide>
  <slide type="all">
    <title>Overview</title>
    <item>Why the hub exists</item>
    <item>Who it is for</item>
    <item>What it answers</item>
  </slide>
</slideshow>
`

const SAMPLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sondahub sample page</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:48px auto;line-height:1.6;color:#1c2430">
<h1>A sample HTML page</h1>
<p>Served by <a href="/">sondahub</a> so an API client has some HTML to look at. It has a <strong>heading</strong>, a paragraph, a list and a table.</p>
<ul><li>One</li><li>Two</li><li>Three</li></ul>
<table><tr><th>Key</th><th>Value</th></tr><tr><td>hub</td><td>sondahub</td></tr><tr><td>client</td><td>Sonda</td></tr></table>
</body></html>`

export { empty, text }
