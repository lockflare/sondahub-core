import { Api, Collection, Row, Relation, allFields } from '../registry/types'
import { Ctx, list, getById, getMany, getChildren, collectionOrThrow, seedCount } from '../data/db'
import { parseQuery, Query, encodeCursor } from '../data/query'
import { createRecord, updateRecord, deleteRecord, OpArgs } from '../data/ops'
import { HubError, json, withEtag, readJson, notFound, baseHeaders } from '../http'
import { hash53 } from '../gen/prng'
import { openApiFor } from './openapi'
import { publicOrigin } from '../env'

export interface RestArgs {
  req: Request
  ctx: Ctx
  url: URL
  api: Api
  /** Path segments after /v1/{api}/ */
  rest: string[]
}

export async function handleRest(a: RestArgs): Promise<Response> {
  const { req, url, api, rest } = a
  const method = req.method.toUpperCase()

  if (rest.length === 0) return apiIndex(a)
  if (rest[0] === 'openapi.json' && rest.length === 1) return json(openApiFor(api, publicBase(a)))

  const c = collectionOrThrow(api, rest[0])
  const ctx = a.ctx
  const ops: OpArgs = { ctx, c }

  // /{collection}
  if (rest.length === 1) {
    if (method === 'GET' || method === 'HEAD') {
      const q = parseQuery(c, url.searchParams)
      const res = await list(ctx, c, q)
      const rows = await expandRows(ctx, c, res.rows, q.expand)
      return listResponse(a, c, q, rows.map((r) => project(r, q.fields, q.expand)), res.total, res.offset)
    }
    if (method === 'POST') {
      const created = await createRecord(ops, await readJson(req))
      return json(created, 201, { Location: `${publicBase(a)}/v1/${api.name}/${c.name}/${created.id}` })
    }
    throw new HubError(405, 'method_not_allowed', `${method} is not allowed on /${api.name}/${c.name}. Use GET to list or POST to create.`, undefined, { Allow: 'GET, POST, HEAD, OPTIONS' })
  }

  // /{collection}/{id}
  const id = parseId(rest[1], c)

  if (rest.length === 2) {
    if (method === 'GET' || method === 'HEAD') {
      const row = await getById(ctx, c, id)
      if (!row) throw notFound(`${c.singular} ${id} does not exist.`)
      const q = parseQuery(c, url.searchParams)
      const [expanded] = await expandRows(ctx, c, [row], q.expand)
      return withEtag(req, project(expanded, q.fields, q.expand))
    }
    if (method === 'PUT' || method === 'PATCH') {
      const saved = await updateRecord(ops, id, await readJson(req), method === 'PUT' ? 'replace' : 'patch')
      return json(saved, 200)
    }
    if (method === 'DELETE') {
      const gone = await deleteRecord(ops, id)
      return json({ deleted: true, id: gone.id, [c.singular]: gone }, 200)
    }
    throw new HubError(405, 'method_not_allowed', `${method} is not allowed on a ${c.singular}. Use GET, PUT, PATCH or DELETE.`, undefined, { Allow: 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS' })
  }

  // /social/users/{id}/avatar.svg: the address every user's avatar_url names
  if (rest.length === 3 && rest[2] === 'avatar.svg' && api.name === 'social' && c.name === 'users' && (method === 'GET' || method === 'HEAD')) {
    const user = await getById(ctx, c, id)
    if (!user) throw notFound(`${c.singular} ${id} does not exist.`)
    return avatar(user)
  }

  // /{collection}/{id}/{relation}
  if (rest.length === 3 && (method === 'GET' || method === 'HEAD')) {
    const rel = c.relations?.find((r) => r.name === rest[2])
    if (!rel) throw notFound(`${c.singular} has no "${rest[2]}". Relations: ${(c.relations ?? []).map((r) => r.name).join(', ') || 'none'}.`)
    const parent = await getById(ctx, c, id)
    if (!parent) throw notFound(`${c.singular} ${id} does not exist.`)
    const target = collectionOrThrow(api, rel.collection)
    if (rel.kind === 'belongsTo') {
      const fk = parent[rel.field]
      if (fk === null || fk === undefined) return json(null)
      const row = await getById(ctx, target, fk as number)
      if (!row) throw notFound(`${target.singular} ${fk} does not exist.`)
      const q = parseQuery(target, url.searchParams)
      const [expanded] = await expandRows(ctx, target, [row], q.expand)
      return withEtag(req, project(expanded, q.fields, q.expand))
    }
    const q = parseQuery(target, url.searchParams)
    const field = allFields(target).find((f) => f.name === rel.field)!
    const res = await list(ctx, target, q, [{ field, op: 'eq', value: id }])
    const rows = await expandRows(ctx, target, res.rows, q.expand)
    return listResponse(a, target, q, rows.map((r) => project(r, q.fields, q.expand)), res.total, res.offset)
  }

  throw notFound(`No such route under /${api.name}/${c.name}.`)
}

/** A round avatar with the user's initials, in a colour of its own (the same for the same user, every time). */
function avatar(user: Row): Response {
  const name = String(user.display_name ?? user.username ?? '?')
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
  const safe = initials.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const hue = hash53(String(user.username ?? user.id)) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="hsl(${hue},55%,45%)"/><text x="64" y="64" dy=".35em" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="52" fill="#fff">${safe}</text></svg>`
  return new Response(svg, { status: 200, headers: baseHeaders({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }) })
}

function parseId(s: string, c: Collection): number {
  if (!/^\d+$/.test(s)) throw new HubError(400, 'bad_id', `"${s}" is not a ${c.singular} id; ids are whole numbers.`)
  return parseInt(s, 10)
}

function project(row: Row, fields: string[] | null, expand: string[] = []): Row {
  if (!fields) return row
  const out: Row = {}
  for (const f of fields) if (f in row) out[f] = row[f]
  for (const e of expand) if (e in row) out[e] = row[e]
  return out
}

/** Embed the related records the query asked for. */
export async function expandRows(ctx: Ctx, c: Collection, rows: Row[], expand: string[]): Promise<Row[]> {
  if (!expand.length || !rows.length) return rows
  const out = rows.map((r) => ({ ...r }))
  for (const name of expand) {
    const rel = c.relations?.find((r) => r.name === name) as Relation
    const target = collectionOrThrow(ctx.api, rel.collection)
    if (rel.kind === 'belongsTo') {
      const ids = out.map((r) => r[rel.field]).filter((v) => v !== null && v !== undefined) as number[]
      const found = await getMany(ctx, target, ids)
      for (const r of out) {
        const fk = r[rel.field]
        r[name] = fk === null || fk === undefined ? null : found.get(fk as number) ?? null
      }
    } else {
      const ids = out.map((r) => r.id as number)
      const children = await getChildren(ctx, target, rel.field, ids)
      const byParent = new Map<number, Row[]>()
      for (const ch of children) {
        const k = ch[rel.field] as number
        const arr = byParent.get(k) ?? []
        if (arr.length < 100) arr.push(ch)
        byParent.set(k, arr)
      }
      for (const r of out) r[name] = byParent.get(r.id as number) ?? []
    }
  }
  return out
}

function listResponse(a: RestArgs, c: Collection, q: Query, rows: Row[], total: number, offset = q.offset): Response {
  const pages = Math.max(1, Math.ceil(total / q.limit))
  const links: string[] = []
  const strip = (u: URL) => {
    for (const k of ['page', 'offset', 'key', 'cursor', 'starting_after', 'ending_before']) u.searchParams.delete(k)
    u.searchParams.set('limit', String(q.limit))
    return u
  }
  const mk = (page: number) => {
    const u = strip(new URL(a.url.toString()))
    u.searchParams.set('page', String(page))
    return `<${publicBase(a)}${u.pathname}${u.search}>`
  }
  const mkCursor = (at: number) => {
    const u = strip(new URL(a.url.toString()))
    u.searchParams.set('cursor', encodeCursor(at, q.key ?? ''))
    return `<${publicBase(a)}${u.pathname}${u.search}>`
  }
  const page = Math.floor(offset / q.limit) + 1
  const hasMore = offset + rows.length < total
  const meta: Record<string, unknown> = { page, limit: q.limit, total, pages }
  if (q.cursorMode) {
    meta.has_more = hasMore
    meta.next_cursor = hasMore ? encodeCursor(offset + rows.length, q.key ?? '') : null
    meta.prev_cursor = offset > 0 ? encodeCursor(Math.max(0, offset - q.limit), q.key ?? '') : null
    if (hasMore) links.push(`${mkCursor(offset + rows.length)}; rel="next"`)
    if (offset > 0) links.push(`${mkCursor(Math.max(0, offset - q.limit))}; rel="prev"`)
    links.push(`${mkCursor(0)}; rel="first"`)
  } else {
    if (page < pages) links.push(`${mk(page + 1)}; rel="next"`)
    if (page > 1) links.push(`${mk(page - 1)}; rel="prev"`)
    links.push(`${mk(1)}; rel="first"`, `${mk(pages)}; rel="last"`)
  }
  const body = { data: rows, meta }
  return withEtag(a.req, body, 200, { 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Pages': String(pages), Link: links.join(', ') })
}

export function publicBase(a: RestArgs): string {
  return publicOrigin(a.url)
}

function apiIndex(a: RestArgs): Response {
  const base = publicBase(a)
  const api = a.api
  return json({
    name: api.name,
    title: api.title,
    description: api.tagline,
    openapi: `${base}/v1/${api.name}/openapi.json`,
    graphql: `${base}/v1/${api.name}/graphql`,
    websocket: `${base.replace(/^http/, 'ws')}/v1/${api.name}/ws`,
    sse: `${base}/v1/${api.name}/events`,
    data: api.collections.map((c) => `${base}/data/${api.name}/${c.name}.json`),
    writes: 'POST, PUT, PATCH and DELETE are validated, run through the rules and kept in memory until the server stops or POST /v1/reset puts the seed back.',
    collections: api.collections.map((c) => ({
      name: c.name,
      url: `${base}/v1/${api.name}/${c.name}`,
      seed_records: seedCount(api, c),
      fields: allFields(c).map((f) => f.name),
      relations: (c.relations ?? []).map((r) => `${r.name} (${r.kind} ${r.collection})`),
    })),
    feeds: api.feeds,
  })
}
