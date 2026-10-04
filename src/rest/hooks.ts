// What a plain CRUD engine cannot know: an order totals its items, a ticket
// has allowed status moves, a like counts once. One hook set per collection
// that needs it; everything else is generic.

import { Collection, Row } from '../registry/types'
import { Ctx, getById, insert, upsert, collectionOrThrow, list } from '../data/db'
import { HubError, nowIso } from '../http'
import { TICKET_TRANSITIONS } from '../registry/helpdesk'
import { Mode } from '../data/validate'
import { parseQuery } from '../data/query'

export interface HookCtx {
  ctx: Ctx
  c: Collection
}

export interface Hooks {
  /** Body keys accepted beyond the collection's fields; handed to beforeCreate as extras. */
  extraKeys?: string[]
  beforeCreate?: (h: HookCtx, row: Row, extras: Row) => Promise<{ row: Row; derive?: (id: number) => Row }>
  afterCreate?: (h: HookCtx, row: Row, extras: Row) => Promise<Row | void>
  beforeUpdate?: (h: HookCtx, existing: Row, patch: Row, mode: Mode) => Promise<Row>
  afterUpdate?: (h: HookCtx, before: Row, after: Row) => Promise<void>
  afterDelete?: (h: HookCtx, row: Row) => Promise<void>
}

function money(v: number): number {
  return Math.round(v * 100) / 100
}

function randomCode(n: number, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

async function bump(h: HookCtx, collection: string, id: number | null | undefined, field: string, delta: number): Promise<void> {
  if (id === null || id === undefined) return
  const c = collectionOrThrow(h.ctx.api, collection)
  const row = await getById(h.ctx, c, id)
  if (!row) return
  const next = Math.max(0, Number(row[field] ?? 0) + delta)
  await upsert(h.ctx, c, { ...row, [field]: next })
}

const HOOKS: Record<string, Hooks> = {
  // ----- store -----
  'store/orders': {
    extraKeys: ['items'],
    beforeCreate: async (h, row, extras) => {
      const products = collectionOrThrow(h.ctx.api, 'products')
      const items = extras.items
      if (items !== undefined) {
        if (!Array.isArray(items) || !items.length) throw new HubError(422, 'validation_failed', 'items must be a non-empty array of { product_id, quantity }.', [{ field: 'items', message: 'must be a non-empty array' }])
        let subtotal = 0
        const lines: Row[] = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i] as Row
          const pid = Number(it?.product_id)
          const qty = Number(it?.quantity ?? 1)
          if (!Number.isInteger(pid)) throw new HubError(422, 'validation_failed', `items[${i}].product_id must be a whole number.`, [{ field: `items[${i}].product_id`, message: 'must be a whole number' }])
          if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new HubError(422, 'validation_failed', `items[${i}].quantity must be between 1 and 999.`, [{ field: `items[${i}].quantity`, message: 'must be 1–999' }])
          const p = await getById(h.ctx, products, pid)
          if (!p) throw new HubError(422, 'validation_failed', `items[${i}].product_id points at product ${pid}, which does not exist.`, [{ field: `items[${i}].product_id`, message: 'does not exist' }])
          const line = money(Number(p.price) * qty)
          subtotal = money(subtotal + line)
          lines.push({ product_id: p.id, sku: p.sku, name: p.name, quantity: qty, unit_price: p.price, line_total: line })
        }
        extras.lines = lines
        const method = (row.shipping_method as string) ?? 'standard'
        const shipping = row.shipping ?? (method === 'pickup' ? 0 : method === 'standard' ? 5.99 : method === 'express' ? 14.99 : 29.99)
        const discount = Number(row.discount ?? 0)
        const tax = row.tax ?? money((subtotal - discount) * 0.07)
        row = { ...row, subtotal, shipping, discount, tax, total: money(subtotal - discount + Number(shipping) + Number(tax)), shipping_method: method }
      }
      const status = (row.status as string) ?? 'pending'
      const now = nowIso()
      return {
        row: { ...row, status, currency: row.currency ?? 'USD', placed_at: row.placed_at ?? now, paid_at: row.paid_at ?? (status === 'pending' ? null : now) },
        derive: (id) => ({ number: `SH-${100000 + id}` }),
      }
    },
    afterCreate: async (h, row, extras) => {
      const lines = extras.lines as Row[] | undefined
      if (!lines) return
      const orderItems = collectionOrThrow(h.ctx.api, 'order_items')
      const out: Row[] = []
      for (const l of lines) out.push(await insert(h.ctx, orderItems, { ...l, order_id: row.id }))
      await bump(h, 'customers', row.customer_id as number, 'orders_count', 1)
      return { ...row, items: out }
    },
    beforeUpdate: async (h, existing, patch) => {
      const now = nowIso()
      if (patch.status && patch.status !== existing.status) {
        const s = patch.status as string
        if (s === 'paid' && !existing.paid_at && !patch.paid_at) patch.paid_at = now
        if (s === 'shipped' && !existing.shipped_at && !patch.shipped_at) patch.shipped_at = now
        if (s === 'delivered' && !existing.delivered_at && !patch.delivered_at) patch.delivered_at = now
        if (s === 'shipped' && !existing.tracking_number && !patch.tracking_number) patch.tracking_number = `1Z${randomCode(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}`
      }
      return patch
    },
  },
  'store/reviews': {
    afterCreate: async (h, row) => {
      const products = collectionOrThrow(h.ctx.api, 'products')
      const p = await getById(h.ctx, products, row.product_id as number)
      if (!p) return
      const n = Number(p.review_count ?? 0)
      const avg = Number(p.rating ?? 0)
      const next = Math.round(((avg * n + Number(row.rating)) / (n + 1)) * 10) / 10
      await upsert(h.ctx, products, { ...p, rating: next, review_count: n + 1 })
    },
  },

  // ----- helpdesk -----
  'helpdesk/tickets': {
    beforeCreate: async (h, row) => {
      const customers = collectionOrThrow(h.ctx.api, 'customers')
      const cust = await getById(h.ctx, customers, row.customer_id as number)
      const sla = Number(cust?.sla_hours ?? 24)
      return {
        row: { ...row, status: row.status ?? 'open', priority: row.priority ?? 'normal', channel: row.channel ?? 'api', requester_email: row.requester_email ?? cust?.contact_email ?? null, due_at: row.due_at ?? new Date(Date.now() + sla * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'), sla_breached: false, message_count: 0 },
        derive: (id) => ({ number: `HD-${10000 + id}` }),
      }
    },
    afterCreate: async (h, row) => {
      await bump(h, 'customers', row.customer_id as number, 'open_tickets', 1)
      if (row.assignee_id) await bump(h, 'agents', row.assignee_id as number, 'open_tickets', 1)
    },
    beforeUpdate: async (h, existing, patch) => {
      const now = nowIso()
      if (patch.status !== undefined && patch.status !== existing.status) {
        const from = existing.status as string
        const to = patch.status as string
        const allowed = TICKET_TRANSITIONS[from] ?? []
        if (!allowed.includes(to)) {
          throw new HubError(422, 'invalid_transition', `A ${from} ticket cannot go to ${to}. From ${from} it can go to: ${allowed.join(', ')}.`, [{ field: 'status', message: `cannot move from ${from} to ${to}` }])
        }
        if (to === 'resolved') patch.resolved_at = now
        if (to === 'closed') patch.closed_at = now
        if (to === 'open') {
          patch.resolved_at = null
          patch.closed_at = null
        }
      }
      if (patch.assignee_id !== undefined && patch.assignee_id !== null && !existing.first_response_at) patch.first_response_at = now
      return patch
    },
    afterUpdate: async (h, before, after) => {
      const wasOpen = before.status === 'open' || before.status === 'pending'
      const isOpen = after.status === 'open' || after.status === 'pending'
      if (wasOpen !== isOpen) {
        await bump(h, 'customers', after.customer_id as number, 'open_tickets', isOpen ? 1 : -1)
        if (after.assignee_id) await bump(h, 'agents', after.assignee_id as number, 'open_tickets', isOpen ? 1 : -1)
      }
    },
  },
  'helpdesk/messages': {
    beforeCreate: async (h, row) => {
      if (row.author_type === 'agent' && row.author_id) {
        const agents = collectionOrThrow(h.ctx.api, 'agents')
        const a = await getById(h.ctx, agents, row.author_id as number)
        if (a && !row.author_name) row = { ...row, author_name: a.name }
      }
      return { row: { ...row, internal: row.internal ?? false, attachments: row.attachments ?? [] } }
    },
    afterCreate: async (h, row) => {
      const tickets = collectionOrThrow(h.ctx.api, 'tickets')
      const t = await getById(h.ctx, tickets, row.ticket_id as number)
      if (!t) return
      const patch: Row = { message_count: Number(t.message_count ?? 0) + 1 }
      if (row.author_type === 'agent' && !t.first_response_at) patch.first_response_at = nowIso()
      if (row.author_type === 'customer' && t.status === 'pending') patch.status = 'open'
      await upsert(h.ctx, tickets, { ...t, ...patch })
    },
  },

  // ----- social -----
  'social/posts': {
    beforeCreate: async (h, row) => ({ row: { ...row, hashtags: row.hashtags ?? [], media: row.media ?? [], visibility: row.visibility ?? 'public', likes_count: 0, comments_count: 0, reposts_count: 0, language: row.language ?? 'en', published_at: row.published_at ?? nowIso() } }),
    afterCreate: async (h, row) => {
      await bump(h, 'users', row.author_id as number, 'posts_count', 1)
    },
    afterDelete: async (h, row) => {
      await bump(h, 'users', row.author_id as number, 'posts_count', -1)
    },
  },
  'social/comments': {
    beforeCreate: async (h, row) => ({ row: { ...row, likes_count: 0, flagged: row.flagged ?? false } }),
    afterCreate: async (h, row) => {
      await bump(h, 'posts', row.post_id as number, 'comments_count', 1)
    },
    afterDelete: async (h, row) => {
      await bump(h, 'posts', row.post_id as number, 'comments_count', -1)
    },
  },
  'social/likes': {
    beforeCreate: async (h, row) => {
      const likes = collectionOrThrow(h.ctx.api, 'likes')
      const dup = await list(h.ctx, likes, parseQuery(likes, new URLSearchParams({ user_id: String(row.user_id), post_id: String(row.post_id), limit: '1' })))
      if (dup.total > 0) throw new HubError(409, 'already_liked', `User ${row.user_id} already likes post ${row.post_id} (like ${dup.rows[0].id}).`)
      return { row }
    },
    afterCreate: async (h, row) => {
      await bump(h, 'posts', row.post_id as number, 'likes_count', 1)
    },
    afterDelete: async (h, row) => {
      await bump(h, 'posts', row.post_id as number, 'likes_count', -1)
    },
  },
  'social/follows': {
    beforeCreate: async (h, row) => {
      if (row.follower_id === row.followee_id) throw new HubError(422, 'validation_failed', 'A user cannot follow the same user.', [{ field: 'followee_id', message: 'must differ from follower_id' }])
      const follows = collectionOrThrow(h.ctx.api, 'follows')
      const dup = await list(h.ctx, follows, parseQuery(follows, new URLSearchParams({ follower_id: String(row.follower_id), followee_id: String(row.followee_id), limit: '1' })))
      if (dup.total > 0) throw new HubError(409, 'already_following', `User ${row.follower_id} already follows user ${row.followee_id} (follow ${dup.rows[0].id}).`)
      const users = collectionOrThrow(h.ctx.api, 'users')
      const target = await getById(h.ctx, users, row.followee_id as number)
      return { row: { ...row, status: row.status ?? (target?.private ? 'pending' : 'active'), notifications: row.notifications ?? false } }
    },
    afterCreate: async (h, row) => {
      if (row.status !== 'active') return
      await bump(h, 'users', row.follower_id as number, 'following_count', 1)
      await bump(h, 'users', row.followee_id as number, 'followers_count', 1)
    },
    afterDelete: async (h, row) => {
      if (row.status !== 'active') return
      await bump(h, 'users', row.follower_id as number, 'following_count', -1)
      await bump(h, 'users', row.followee_id as number, 'followers_count', -1)
    },
  },
}

export function hooksFor(api: string, collection: string): Hooks {
  return HOOKS[`${api}/${collection}`] ?? {}
}
