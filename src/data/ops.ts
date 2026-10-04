// Create, update and delete with validation and hooks — the one
// implementation REST and GraphQL both call. Everything lands in the
// request's overlay, which is kept when the request succeeds.

import { Collection, Row } from '../registry/types'
import { Ctx, getById, insert, upsert, remove } from './db'
import { validate, checkRefs, Mode } from './validate'
import { notFound } from '../http'
import { hooksFor, HookCtx } from '../rest/hooks'

export interface OpArgs {
  ctx: Ctx
  c: Collection
}

function hookCtx(a: OpArgs): HookCtx {
  return { ctx: a.ctx, c: a.c }
}

function blank(c: Collection): Row {
  const out: Row = {}
  for (const f of c.fields) out[f.name] = null
  return out
}

export async function createRecord(a: OpArgs, body: unknown): Promise<Row> {
  const hooks = hooksFor(a.ctx.api.name, a.c.name)
  const h = hookCtx(a)
  const extras: Row = {}
  for (const k of hooks.extraKeys ?? []) if (body && typeof body === 'object' && k in (body as Row)) extras[k] = (body as Row)[k]
  let row = validate(a.c, body, 'create', hooks.extraKeys)
  let derive: ((id: number) => Row) | undefined
  if (hooks.beforeCreate) {
    const r = await hooks.beforeCreate(h, row, extras)
    row = r.row
    derive = r.derive
  }
  await checkRefs(a.ctx, a.c, row)
  let created = await insert(a.ctx, a.c, row, derive)
  if (hooks.afterCreate) {
    const r = await hooks.afterCreate(h, created, extras)
    if (r) created = r
  }
  return created
}

export async function updateRecord(a: OpArgs, id: number, body: unknown, mode: Mode): Promise<Row> {
  const hooks = hooksFor(a.ctx.api.name, a.c.name)
  const h = hookCtx(a)
  const existing = await getById(a.ctx, a.c, id)
  if (!existing) throw notFound(`${a.c.singular} ${id} does not exist.`)
  let patch = validate(a.c, body, mode)
  if (hooks.beforeUpdate) patch = await hooks.beforeUpdate(h, existing, patch, mode)
  // a replace keeps what the server computes (ratings, counts, totals): a client cannot send those
  const computed: Row = {}
  for (const f of a.c.fields) if (f.readonly) computed[f.name] = existing[f.name]
  const merged: Row = mode === 'replace' ? { ...blank(a.c), ...patch, ...computed, id, created_at: existing.created_at } : { ...existing, ...patch }
  await checkRefs(a.ctx, a.c, merged)
  const saved = await upsert(a.ctx, a.c, merged)
  if (hooks.afterUpdate) await hooks.afterUpdate(h, existing, saved)
  return saved
}

export async function deleteRecord(a: OpArgs, id: number): Promise<Row> {
  const hooks = hooksFor(a.ctx.api.name, a.c.name)
  const h = hookCtx(a)
  const existing = await getById(a.ctx, a.c, id)
  if (!existing) throw notFound(`${a.c.singular} ${id} does not exist.`)
  await remove(a.ctx, a.c, existing)
  if (hooks.afterDelete) await hooks.afterDelete(h, existing)
  return existing
}
