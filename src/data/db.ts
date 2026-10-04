// The data layer. Every API's seed is generated in memory when the server
// starts (deterministic: the same rows with the same ids on every start),
// and the writes clients make are kept beside it, in memory, until the
// server stops or POST /v1/reset puts the seed back.
//
// A read sees the seed with the kept writes applied. A write works on a copy
// of the kept writes, and the copy replaces them only when the request
// succeeds, so a request that fails part way changes nothing. Writes run one
// at a time; reads never wait.

import { Api, Collection, Field, Row, allFields, findCollection } from '../registry/types'
import { APIS, GENERATORS, apiShape } from '../registry'
import { Filter, Query, Sort } from './query'
import { HubError, nowIso } from '../http'

interface Loaded {
  rows: Row[]
  byId: Map<number, Row>
  maxId: number
}

export interface OverlayEntry {
  rows: Map<number, Row>
  deleted: Set<number>
  /** The next id to hand out; the seed's highest id + 1 until the collection is first written. */
  nextId: number
}

/** The writes made to one API: per collection, the rows created or changed and the ids deleted. */
export class Overlay {
  entries = new Map<string, OverlayEntry>()
  /** Writes made through this overlay since it was created or copied. */
  writes = 0
  entry(c: Collection, loaded: Loaded): OverlayEntry {
    let e = this.entries.get(c.name)
    if (!e) this.entries.set(c.name, (e = { rows: new Map(), deleted: new Set(), nextId: loaded.maxId + 1 }))
    if (e.nextId <= loaded.maxId) e.nextId = loaded.maxId + 1
    return e
  }
  get(name: string): OverlayEntry | undefined {
    return this.entries.get(name)
  }
  /** A copy a write can change freely: rows are never changed in place, so copying the maps is enough. */
  copy(): Overlay {
    const o = new Overlay()
    for (const [k, e] of this.entries) o.entries.set(k, { rows: new Map(e.rows), deleted: new Set(e.deleted), nextId: e.nextId })
    return o
  }
  /** Whether anything at all is in it. */
  get empty(): boolean {
    for (const e of this.entries.values()) if (e.rows.size || e.deleted.size) return false
    return true
  }
}

export interface Ctx {
  api: Api
  overlay: Overlay
}

// ---------- the seed, in memory ----------

const seeds = new Map<string, Map<string, Loaded>>()

function seedOf(api: Api): Map<string, Loaded> {
  let m = seeds.get(api.name)
  if (m) return m
  m = new Map()
  const raw = GENERATORS[api.name]()
  for (const c of api.collections) {
    const rows = (raw[c.name] ?? []).map((r) => apiShape(c, r))
    const byId = new Map<number, Row>()
    let maxId = 0
    for (const r of rows) {
      byId.set(r.id as number, r)
      if ((r.id as number) > maxId) maxId = r.id as number
    }
    m.set(c.name, { rows, byId, maxId })
  }
  seeds.set(api.name, m)
  return m
}

async function load(ctx: Ctx, c: Collection): Promise<Loaded> {
  return seedOf(ctx.api).get(c.name)!
}

/** Generates every API's seed now, so the first request does not wait for it. */
export function warm(): void {
  for (const a of APIS) seedOf(a)
}

/** The seed rows of a collection, as generated (what /data/{api}/{collection}.json serves). */
export function seedRows(api: Api, c: Collection): Row[] {
  return seedOf(api).get(c.name)!.rows
}

/** How many rows the seed has in a collection. */
export function seedCount(api: Api, c: Collection): number {
  return seedOf(api).get(c.name)!.rows.length
}

// ---------- the kept writes ----------

const kept = new Map<string, Overlay>()

/** The writes kept for an API: what every read sees. Read-only; a write works on keptWrites(api).copy(). */
export function keptWrites(api: string): Overlay {
  let o = kept.get(api)
  if (!o) kept.set(api, (o = new Overlay()))
  return o
}

/** A write's copy becomes the kept state. */
export function keep(api: string, o: Overlay): void {
  o.writes = 0
  kept.set(api, o)
}

/** Back to the seed: one API, or all of them. */
export function reset(api?: string): void {
  if (api) kept.delete(api)
  else kept.clear()
}

let queue: Promise<unknown> = Promise.resolve()

/** Runs fn after every write before it has finished: writes never interleave. */
export function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** The collection as this request sees it: seed rows with the overlay applied. Read-only: the rows are shared, copy one before changing it. */
export async function view(ctx: Ctx, c: Collection): Promise<Row[]> {
  const loaded = await load(ctx, c)
  const ov = ctx.overlay.get(c.name)
  if (!ov || (!ov.rows.size && !ov.deleted.size)) return loaded.rows
  const out: Row[] = []
  for (const r of loaded.rows) {
    const id = r.id as number
    if (ov.deleted.has(id)) continue
    out.push(ov.rows.get(id) ?? r)
  }
  for (const [id, r] of ov.rows) if (!loaded.byId.has(id)) out.push(r)
  return out
}

// ---------- reading ----------

function getPath(v: unknown, path: string[]): unknown {
  let cur = v
  for (const p of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function fieldValue(row: Row, f: Filter): unknown {
  const v = row[f.field.name]
  return f.path && f.path.length ? getPath(v, f.path) : v
}

function eq(f: Field, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined
  if (f.type === 'bool') return Boolean(a) === Boolean(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a) === String(b)
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function matches(row: Row, f: Filter): boolean {
  const v = fieldValue(row, f)
  switch (f.op) {
    case 'eq':
      return eq(f.field, v, f.value)
    case 'ne':
      return !eq(f.field, v, f.value)
    case 'gt':
      return v !== null && v !== undefined && cmp(v, f.value) > 0
    case 'gte':
      return v !== null && v !== undefined && cmp(v, f.value) >= 0
    case 'lt':
      return v !== null && v !== undefined && cmp(v, f.value) < 0
    case 'lte':
      return v !== null && v !== undefined && cmp(v, f.value) <= 0
    case 'like': {
      if (v === null || v === undefined) return false
      const hay = (typeof v === 'object' ? JSON.stringify(v) : String(v)).toLowerCase()
      return hay.includes(String(f.value).toLowerCase())
    }
    case 'in':
      return (f.value as unknown[]).some((x) => eq(f.field, v, x))
    case 'null':
      return f.value ? v === null || v === undefined : v !== null && v !== undefined
  }
}

function searchable(c: Collection): Field[] {
  return allFields(c).filter((f) => (f.type === 'string' || f.type === 'text' || f.type === 'enum' || (f.type === 'json' && f.search)) && f.search !== false)
}

function sorter(sort: Sort[]): (a: Row, b: Row) => number {
  return (a, b) => {
    for (const s of sort) {
      const va = a[s.field]
      const vb = b[s.field]
      const na = va === null || va === undefined
      const nb = vb === null || vb === undefined
      if (na && nb) continue
      if (na) return 1
      if (nb) return -1
      const c = cmp(va, vb)
      if (c !== 0) return s.desc ? -c : c
    }
    return 0
  }
}

export interface ListResult {
  rows: Row[]
  total: number
  /** Where the page starts in the full ordered list. */
  offset: number
}

export async function list(ctx: Ctx, c: Collection, q: Query, extraFilters: Filter[] = []): Promise<ListResult> {
  let rows = await view(ctx, c)
  const filters = [...extraFilters, ...q.filters]
  if (filters.length) rows = rows.filter((r) => filters.every((f) => matches(r, f)))
  if (q.q) {
    const needle = q.q.toLowerCase()
    const fields = searchable(c)
    rows = rows.filter((r) =>
      fields.some((f) => {
        const v = r[f.name]
        if (v === null || v === undefined) return false
        return (typeof v === 'object' ? JSON.stringify(v) : String(v)).toLowerCase().includes(needle)
      }),
    )
  }
  const sorted = rows.slice().sort(sorter(q.sort))
  let start = q.offset
  let end = q.offset + q.limit
  if (q.after !== undefined && q.after !== null) {
    const i = sorted.findIndex((r) => r.id === q.after)
    if (i < 0) throw new HubError(400, 'bad_cursor', `starting_after=${q.after}: no ${c.singular} with that id is in this list.`)
    start = i + 1
    end = start + q.limit
  } else if (q.before !== undefined && q.before !== null) {
    const i = sorted.findIndex((r) => r.id === q.before)
    if (i < 0) throw new HubError(400, 'bad_cursor', `ending_before=${q.before}: no ${c.singular} with that id is in this list.`)
    end = i
    start = Math.max(0, end - q.limit)
  }
  return { rows: sorted.slice(start, end).map(copy), total: sorted.length, offset: start }
}

export async function getById(ctx: Ctx, c: Collection, id: number): Promise<Row | null> {
  const loaded = await load(ctx, c)
  const ov = ctx.overlay.get(c.name)
  if (ov?.deleted.has(id)) return null
  const r = ov?.rows.get(id) ?? loaded.byId.get(id)
  return r ? copy(r) : null
}

export async function getMany(ctx: Ctx, c: Collection, ids: number[]): Promise<Map<number, Row>> {
  const out = new Map<number, Row>()
  for (const id of new Set(ids)) {
    const r = await getById(ctx, c, id)
    if (r) out.set(id, r)
  }
  return out
}

/** Children of many parents: rows whose `field` is one of the ids, id order, capped. */
export async function getChildren(ctx: Ctx, c: Collection, field: string, ids: number[], cap = 2000): Promise<Row[]> {
  const want = new Set(ids)
  const rows = await view(ctx, c)
  const out: Row[] = []
  for (const r of rows) {
    if (want.has(r[field] as number)) {
      out.push(copy(r))
      if (out.length >= cap) break
    }
  }
  return out
}

/** Every row of a collection as this request sees it (seed + overlay), in seed order. */
export async function allRows(ctx: Ctx, c: Collection): Promise<Row[]> {
  return (await view(ctx, c)).map(copy)
}

export async function exists(ctx: Ctx, c: Collection, id: number): Promise<boolean> {
  return (await getById(ctx, c, id)) !== null
}

// ---------- writing (into the request's overlay) ----------

/** Insert a row; `derive` may add fields once the id is known. */
export async function insert(ctx: Ctx, c: Collection, row: Row, derive?: (id: number) => Row): Promise<Row> {
  const loaded = await load(ctx, c)
  const ov = ctx.overlay.entry(c, loaded)
  const id = ov.nextId++
  const now = nowIso()
  const full = normalize(c, { ...row, ...(derive ? derive(id) : {}), id, created_at: now, updated_at: now })
  ov.rows.set(id, full)
  ctx.overlay.writes++
  return copy(full)
}

/** Replace the request's copy of a row. */
export async function upsert(ctx: Ctx, c: Collection, row: Row): Promise<Row> {
  const loaded = await load(ctx, c)
  const ov = ctx.overlay.entry(c, loaded)
  const full = normalize(c, { ...row, updated_at: nowIso() })
  ov.rows.set(full.id as number, full)
  ov.deleted.delete(full.id as number)
  ctx.overlay.writes++
  return copy(full)
}

export async function remove(ctx: Ctx, c: Collection, existing: Row): Promise<void> {
  const loaded = await load(ctx, c)
  const ov = ctx.overlay.entry(c, loaded)
  ov.rows.delete(existing.id as number)
  ov.deleted.add(existing.id as number)
  ctx.overlay.writes++
}

/** Every field present, in the registry's order; missing ones null. */
function normalize(c: Collection, row: Row): Row {
  const out: Row = {}
  for (const f of allFields(c)) out[f.name] = row[f.name] === undefined ? null : row[f.name]
  return out
}

function copy(r: Row): Row {
  return { ...r }
}

export function collectionOrThrow(api: Api, name: string): Collection {
  const c = findCollection(api, name)
  if (!c) throw new HubError(404, 'not_found', `${api.name} has no collection "${name}". It has: ${api.collections.map((x) => x.name).join(', ')}.`)
  return c
}

/** A small random sample of a collection, for the live feeds. */
export async function sample(ctx: Ctx, c: Collection, n: number, where?: (r: Row) => boolean): Promise<Row[]> {
  const rows = await view(ctx, c)
  const pool = where ? rows.filter(where) : rows
  if (pool.length <= n) return pool.map(copy)
  const out: Row[] = []
  const step = Math.max(1, Math.floor(pool.length / n))
  const start = Math.floor(Math.random() * step)
  for (let i = start; i < pool.length && out.length < n; i += step) out.push(copy(pool[i]))
  return out
}
