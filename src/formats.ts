// Other shapes for a JSON answer: CSV, XML, YAML, NDJSON and MessagePack,
// chosen by the Accept header (when the first type it names is one of
// these) or by ?format=. A list answers its rows; one record answers itself.

export type Format = 'csv' | 'xml' | 'yaml' | 'ndjson' | 'msgpack'

const BY_TYPE: [string, Format][] = [
  ['text/csv', 'csv'],
  ['application/csv', 'csv'],
  ['application/xml', 'xml'],
  ['text/xml', 'xml'],
  ['application/yaml', 'yaml'],
  ['application/x-yaml', 'yaml'],
  ['text/yaml', 'yaml'],
  ['application/x-ndjson', 'ndjson'],
  ['application/ndjson', 'ndjson'],
  ['application/jsonl', 'ndjson'],
  ['application/msgpack', 'msgpack'],
  ['application/x-msgpack', 'msgpack'],
  ['application/vnd.msgpack', 'msgpack'],
]

export const CONTENT_TYPES: Record<Format, string> = {
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  ndjson: 'application/x-ndjson; charset=utf-8',
  msgpack: 'application/msgpack',
}

/** The format a request asks for, or null for JSON. A browser's Accept (text/html first) never matches. */
export function wantedFormat(req: Request, url: URL): Format | null {
  const q = (url.searchParams.get('format') ?? '').toLowerCase()
  if (q === 'csv' || q === 'xml' || q === 'yaml' || q === 'ndjson' || q === 'msgpack') return q
  if (q === 'jsonl') return 'ndjson'
  const accept = (req.headers.get('Accept') ?? '').toLowerCase()
  const first = accept.split(',')[0]?.split(';')[0]?.trim() ?? ''
  for (const [t, f] of BY_TYPE) if (first === t) return f
  return null
}

function rowsOf(body: unknown): Record<string, unknown>[] {
  if (body && typeof body === 'object' && !Array.isArray(body) && Array.isArray((body as Record<string, unknown>).data)) return (body as { data: Record<string, unknown>[] }).data
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  return [body as Record<string, unknown>]
}

// ---------- CSV (RFC 4180) ----------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(body: unknown): string {
  const rows = rowsOf(body)
  const cols: string[] = []
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r ?? {})) if (!seen.has(k)) seen.add(k), cols.push(k)
  const lines = [cols.map(csvCell).join(',')]
  for (const r of rows) lines.push(cols.map((c) => csvCell(r?.[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

// ---------- XML ----------

function xmlName(s: string): string {
  let n = s.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (!/^[A-Za-z_]/.test(n)) n = '_' + n
  return n
}

function xmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function xmlValue(name: string, v: unknown, item: string, depth: number): string {
  const pad = '  '.repeat(depth)
  const tag = xmlName(name)
  if (v === null || v === undefined) return `${pad}<${tag} nil="true"/>`
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}<${tag}/>`
    return `${pad}<${tag}>\n${v.map((x) => xmlValue(item, x, 'item', depth + 1)).join('\n')}\n${pad}</${tag}>`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (!entries.length) return `${pad}<${tag}/>`
    return `${pad}<${tag}>\n${entries.map(([k, x]) => xmlValue(k, x, 'item', depth + 1)).join('\n')}\n${pad}</${tag}>`
  }
  return `${pad}<${tag}>${xmlText(String(v))}</${tag}>`
}

/** A list as <{plural}><{singular}>…; anything else under <response>. */
export function toXml(body: unknown, plural = 'response', singular = 'item'): string {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n'
  if (body && typeof body === 'object' && !Array.isArray(body) && Array.isArray((body as Record<string, unknown>).data)) {
    const b = body as { data: unknown[]; meta?: Record<string, unknown> }
    const meta = b.meta ? Object.entries(b.meta).map(([k, v]) => ` ${xmlName(k)}="${xmlText(String(v)).replace(/"/g, '&quot;')}"`).join('') : ''
    return `${head}<${xmlName(plural)}${meta}>\n${b.data.map((r) => xmlValue(singular, r, 'item', 1)).join('\n')}\n</${xmlName(plural)}>\n`
  }
  return `${head}${xmlValue(singular === 'item' ? 'response' : singular, body, 'item', 0)}\n`
}

// ---------- YAML ----------

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  if (s === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: | #|[\n\r\t]|^(true|false|null|yes|no|on|off|~)$|^[-+]?(\d|\.\d)/i.test(s)) return JSON.stringify(s)
  return s
}

function yamlKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k) ? k : JSON.stringify(k)
}

function complex(x: unknown): boolean {
  return !!x && typeof x === 'object' && (Array.isArray(x) ? x.length > 0 : Object.keys(x as object).length > 0)
}

function yamlInline(x: unknown): string {
  if (Array.isArray(x)) return '[]'
  if (x && typeof x === 'object') return '{}'
  return yamlScalar(x)
}

function yamlLines(v: unknown, indent: number): string[] {
  const pad = '  '.repeat(indent)
  const out: string[] = []
  if (Array.isArray(v)) {
    for (const x of v) {
      if (complex(x)) {
        const child = yamlLines(x, indent + 1)
        out.push(pad + '- ' + child[0].slice((indent + 1) * 2), ...child.slice(1))
      } else out.push(pad + '- ' + yamlInline(x))
    }
    return out
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (complex(x)) out.push(pad + yamlKey(k) + ':', ...yamlLines(x, indent + 1))
    else out.push(pad + yamlKey(k) + ': ' + yamlInline(x))
  }
  return out
}

export function toYaml(body: unknown): string {
  return (complex(body) ? yamlLines(body, 0).join('\n') : yamlInline(body)) + '\n'
}

// ---------- NDJSON ----------

export function toNdjson(body: unknown): string {
  return rowsOf(body).map((r) => JSON.stringify(r)).join('\n') + '\n'
}

// ---------- MessagePack ----------

export function toMsgpack(v: unknown): Uint8Array {
  const out: number[] = []
  const te = new TextEncoder()
  const u = (n: number, bytes: number) => {
    for (let i = bytes - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff)
  }
  const write = (x: unknown): void => {
    if (x === null || x === undefined) return void out.push(0xc0)
    if (x === false) return void out.push(0xc2)
    if (x === true) return void out.push(0xc3)
    if (typeof x === 'number') {
      if (Number.isInteger(x) && x >= 0 && x <= 0x7f) return void out.push(x)
      if (Number.isInteger(x) && x < 0 && x >= -32) return void out.push(0xe0 | (x + 32))
      if (Number.isInteger(x) && x >= 0 && x <= 0xffffffff) {
        if (x <= 0xff) return void out.push(0xcc, x)
        if (x <= 0xffff) return out.push(0xcd), u(x, 2)
        return out.push(0xce), u(x, 4)
      }
      if (Number.isInteger(x) && x < 0 && x >= -0x80000000) {
        const b = new DataView(new ArrayBuffer(4))
        b.setInt32(0, x)
        return void out.push(0xd2, ...new Uint8Array(b.buffer))
      }
      const b = new DataView(new ArrayBuffer(8))
      b.setFloat64(0, x)
      return void out.push(0xcb, ...new Uint8Array(b.buffer))
    }
    if (typeof x === 'string') {
      const bytes = te.encode(x)
      const n = bytes.length
      if (n < 32) out.push(0xa0 | n)
      else if (n <= 0xff) out.push(0xd9, n)
      else if (n <= 0xffff) out.push(0xda), u(n, 2)
      else out.push(0xdb), u(n, 4)
      for (const b of bytes) out.push(b)
      return
    }
    if (Array.isArray(x)) {
      const n = x.length
      if (n < 16) out.push(0x90 | n)
      else if (n <= 0xffff) out.push(0xdc), u(n, 2)
      else out.push(0xdd), u(n, 4)
      for (const e of x) write(e)
      return
    }
    if (typeof x === 'object') {
      const entries = Object.entries(x as Record<string, unknown>).filter(([, e]) => e !== undefined)
      const n = entries.length
      if (n < 16) out.push(0x80 | n)
      else if (n <= 0xffff) out.push(0xde), u(n, 2)
      else out.push(0xdf), u(n, 4)
      for (const [k, e] of entries) {
        write(k)
        write(e)
      }
      return
    }
    write(String(x))
  }
  write(v)
  return new Uint8Array(out)
}

/** Render a JSON body in the asked format. */
export function render(f: Format, body: unknown, names?: { plural: string; singular: string }): string | Uint8Array {
  switch (f) {
    case 'csv':
      return toCsv(body)
    case 'xml':
      return toXml(body, names?.plural, names?.singular)
    case 'yaml':
      return toYaml(body)
    case 'ndjson':
      return toNdjson(body)
    case 'msgpack':
      return toMsgpack(body)
  }
}
