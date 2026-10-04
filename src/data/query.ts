import { Collection, Field, allFields } from '../registry/types'
import { HubError } from '../http'
import { hash53 } from '../gen/prng'
import { b64url, b64urlDecode, dec } from '../utils/crypto'

export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'null'

export interface Filter {
  field: Field
  /** For json fields: the path inside the document, e.g. ['city']. */
  path?: string[]
  op: Op
  value: unknown
}

export interface Sort {
  field: string
  desc: boolean
}

export interface Query {
  filters: Filter[]
  sort: Sort[]
  page: number
  limit: number
  offset: number
  q: string | null
  fields: string[] | null
  expand: string[]
  /** Cursor paging: asked for with ?cursor=, ?paging=cursor, ?starting_after= or ?ending_before=. */
  cursorMode?: boolean
  /** The rows after (or before) the row with this id, in the query's order. */
  after?: number | null
  before?: number | null
  /** Identifies filters, search and sort, so a cursor cannot be reused on another query. */
  key?: string
}

/** Query parameters that are not filters. Anything starting with _ is reserved, never a field. */
export const RESERVED = new Set(['page', 'limit', 'offset', 'sort', 'q', 'fields', 'expand', 'key', 'cursor', 'paging', 'starting_after', 'ending_before', 'format'])

export function encodeCursor(offset: number, key: string): string {
  return b64url(JSON.stringify({ o: offset, k: key }))
}
export const MAX_LIMIT = 200
export const DEFAULT_LIMIT = 20
/** Generous for any real query, small enough that no request makes a list do unbounded work. */
export const MAX_FILTERS = 50
export const MAX_SORT = 5
export const MAX_Q = 500

const OPS: Op[] = ['ne', 'gte', 'gt', 'lte', 'lt', 'like', 'in', 'null']

export function parseQuery(c: Collection, params: URLSearchParams): Query {
  const fields = allFields(c)
  const byName = new Map(fields.map((f) => [f.name, f]))
  const filters: Filter[] = []
  for (const [rawKey, rawValue] of params.entries()) {
    if (RESERVED.has(rawKey) || rawKey.startsWith('_')) continue
    if (filters.length >= MAX_FILTERS) throw new HubError(400, 'bad_parameter', `A list takes ${MAX_FILTERS} filters at most.`)
    let key = rawKey
    let op: Op = 'eq'
    for (const o of OPS) {
      if (key.endsWith('_' + o)) {
        op = o
        key = key.slice(0, -(o.length + 1))
        break
      }
    }
    let path: string[] | undefined
    let field = byName.get(key)
    if (!field && key.includes('.')) {
      const [head, ...rest] = key.split('.')
      const f = byName.get(head)
      if (f && f.type === 'json') {
        field = f
        path = rest
      }
    }
    if (!field) {
      throw new HubError(400, 'unknown_filter', `"${rawKey}" is not a field of ${c.name}. Fields: ${fields.map((f) => f.name).join(', ')}.`)
    }
    let value: unknown
    if (op === 'null') value = rawValue === '' || rawValue === 'true' || rawValue === '1'
    else if (op === 'in') {
      const parts = rawValue.split(',').map((v) => v.trim()).filter((v) => v !== '')
      if (parts.length > 50) throw new HubError(400, 'bad_parameter', `"${rawKey}" takes 50 values at most.`)
      value = parts.map((v) => coerce(field!, v, path))
    }
    else if (op === 'like') value = rawValue
    else if (rawValue === 'null' && op === 'eq') {
      op = 'null'
      value = true
    } else value = coerce(field, rawValue, path)
    filters.push({ field, path, op, value })
  }

  const sort: Sort[] = []
  const rawSort = params.get('sort') ?? c.sort ?? 'id'
  for (const part of rawSort.split(',')) {
    const p = part.trim()
    if (!p) continue
    const desc = p.startsWith('-')
    const name = desc ? p.slice(1) : p.startsWith('+') ? p.slice(1) : p
    if (!byName.has(name)) throw new HubError(400, 'unknown_sort', `"${name}" is not a field of ${c.name}, so it cannot be sorted on.`)
    if (sort.some((s) => s.field === name)) continue
    if (sort.length >= MAX_SORT) throw new HubError(400, 'bad_parameter', `sort takes ${MAX_SORT} fields at most.`)
    sort.push({ field: name, desc })
  }
  if (!sort.some((s) => s.field === 'id')) sort.push({ field: 'id', desc: sort[0]?.desc ?? false })

  let limit = intParam(params, 'limit', DEFAULT_LIMIT)
  if (limit < 1) limit = 1
  if (limit > MAX_LIMIT) limit = MAX_LIMIT
  let page = intParam(params, 'page', 1)
  if (page < 1) page = 1
  let offset = params.has('offset') ? intParam(params, 'offset', 0) : (page - 1) * limit
  if (offset < 0) offset = 0
  if (params.has('offset')) page = Math.floor(offset / limit) + 1

  const q = params.get('q')?.trim() || null
  if (q && q.length > MAX_Q) throw new HubError(400, 'bad_parameter', `q takes ${MAX_Q} characters at most.`)

  let pick: string[] | null = null
  if (params.get('fields')) {
    pick = params
      .get('fields')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const f of pick) if (!byName.has(f)) throw new HubError(400, 'unknown_field', `"${f}" is not a field of ${c.name}.`)
    if (!pick.includes('id')) pick.unshift('id')
  }

  const expand = (params.get('expand') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const e of expand) {
    if (!c.relations?.some((r) => r.name === e)) {
      throw new HubError(400, 'unknown_relation', `"${e}" is not a relation of ${c.name}. Relations: ${(c.relations ?? []).map((r) => r.name).join(', ') || 'none'}.`)
    }
  }

  const key = hash53(JSON.stringify([filters.map((f) => [f.field.name, f.path, f.op, f.value]), sort, q])).toString(36)
  const cursorRaw = params.get('cursor')
  const after = params.has('starting_after') ? intParam(params, 'starting_after', 0) : null
  const before = params.has('ending_before') ? intParam(params, 'ending_before', 0) : null
  const cursorMode = cursorRaw !== null || after !== null || before !== null || params.get('paging') === 'cursor'
  if (cursorRaw) {
    let c: { o?: unknown; k?: unknown }
    try {
      c = JSON.parse(dec.decode(b64urlDecode(cursorRaw)))
    } catch {
      throw new HubError(400, 'bad_cursor', 'The cursor is not one this server gave out.')
    }
    if (typeof c.o !== 'number' || c.o < 0) throw new HubError(400, 'bad_cursor', 'The cursor is not one this server gave out.')
    if (c.k !== key) throw new HubError(400, 'bad_cursor', 'The cursor belongs to a query with other filters, search or sort; keep those the same while paging.')
    offset = c.o
    page = Math.floor(offset / limit) + 1
  }

  return { filters, sort, page, limit, offset, q, fields: pick, expand, cursorMode, after, before, key }
}

function intParam(params: URLSearchParams, name: string, def: number): number {
  const v = params.get(name)
  if (v === null || v === '') return def
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) throw new HubError(400, 'bad_parameter', `"${name}" must be a whole number.`)
  return n
}

/** Turn a query-string value into the field's type. */
export function coerce(f: Field, raw: string, path?: string[]): unknown {
  if (path) {
    // inside a json document we do not know the type: numbers stay numbers, booleans booleans
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
    return raw
  }
  switch (f.type) {
    case 'int':
    case 'ref': {
      if (!/^-?\d+$/.test(raw)) throw new HubError(400, 'bad_parameter', `"${f.name}" takes a whole number, not "${raw}".`)
      return parseInt(raw, 10)
    }
    case 'float': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new HubError(400, 'bad_parameter', `"${f.name}" takes a number, not "${raw}".`)
      return n
    }
    case 'bool': {
      if (raw === 'true' || raw === '1') return 1
      if (raw === 'false' || raw === '0') return 0
      throw new HubError(400, 'bad_parameter', `"${f.name}" takes true or false, not "${raw}".`)
    }
    default:
      return raw
  }
}
