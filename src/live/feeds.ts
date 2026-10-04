// The synthetic activity a live stream publishes: orders moving, stock
// changing, posts and likes, tickets changing. Drawn from a sample of the
// data each stream reads once when it opens, so an event names real records.

import { Rng } from '../gen/prng'
import { Ctx, sample, collectionOrThrow } from '../data/db'
import { POST_CLOSERS, POST_OPENERS, POST_TOPICS, HASHTAGS, COMMENT_LINES, AGENT_LINES } from '../gen/words'

export interface FeedEvent {
  topic: string
  data: Record<string, unknown>
}

export interface Sample {
  loadedAt: number
  rows: Record<string, Record<string, unknown>[]>
}

/** What each API's feed draws from: small samples of the seed, read once per connection. */
export async function loadSample(ctx: Ctx, api: string): Promise<Sample> {
  const c = (name: string) => collectionOrThrow(ctx.api, name)
  const rows: Record<string, Record<string, unknown>[]> = {}
  switch (api) {
    case 'store':
      rows.orders = await sample(ctx, c('orders'), 60, (r) => ['pending', 'paid', 'shipped'].includes(String(r.status)))
      rows.products = await sample(ctx, c('products'), 40, (r) => r.status === 'active')
      rows.warehouses = await sample(ctx, c('warehouses'), 10)
      break
    case 'social':
      rows.users = await sample(ctx, c('users'), 40)
      rows.posts = await sample(ctx, c('posts'), 40)
      break
    case 'helpdesk':
      rows.tickets = await sample(ctx, c('tickets'), 40, (r) => r.status === 'open' || r.status === 'pending')
      rows.agents = await sample(ctx, c('agents'), 30)
      rows.customers = await sample(ctx, c('customers'), 30)
      break
  }
  return { loadedAt: Date.now(), rows }
}

export interface FeedState {
  tick: number
  rng: Rng
  /** Per-order / per-ticket current status. */
  status: Record<string, string>
}

export function newFeedState(seed: string): FeedState {
  return { tick: 0, rng: new Rng(seed + ':' + Date.now()), status: {} }
}

const ORDER_NEXT: Record<string, string> = { pending: 'paid', paid: 'shipped', shipped: 'delivered' }
const TICKET_NEXT: Record<string, string[]> = { open: ['pending', 'resolved'], pending: ['open', 'resolved'], resolved: ['closed'] }

function pick<T>(r: Rng, arr: T[] | undefined): T | undefined {
  return arr && arr.length ? arr[r.int(0, arr.length - 1)] : undefined
}

/** The events for one tick of an API's room. Empty when the tick has nothing to say. */
export function tickEvents(api: string, sample: Sample, st: FeedState): FeedEvent[] {
  st.tick++
  const r = st.rng
  const t = st.tick
  const out: FeedEvent[] = []
  const rows = sample.rows
  switch (api) {
    case 'store': {
      if (t % 4 === 0) {
        const o = pick(r, rows.orders)
        if (o) {
          const id = String(o.id)
          const from = st.status[id] ?? String(o.status)
          const to = ORDER_NEXT[from]
          if (to) {
            st.status[id] = to
            out.push({ topic: 'orders', data: { id: o.id, number: o.number, customer_id: o.customer_id, status: to, previous: from, total: o.total, ...(to === 'shipped' ? { tracking_number: `1Z${r.code(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}` } : {}) } })
          }
        }
      }
      if (t % 6 === 0) {
        const p = pick(r, rows.products)
        const w = pick(r, rows.warehouses)
        if (p && w) {
          const delta = r.weighted([[-r.int(1, 5), 60], [r.int(10, 80), 40]] as const)
          out.push({ topic: 'inventory', data: { product_id: p.id, sku: p.sku, name: p.name, warehouse_id: w.id, warehouse: w.code, delta, reason: delta < 0 ? 'order picked' : 'restock received' } })
        }
      }
      break
    }
    case 'social': {
      if (t % 2 === 0) {
        const u = pick(r, rows.users)
        const p = pick(r, rows.posts)
        if (u && p) out.push({ topic: 'likes', data: { user_id: u.id, username: u.username, post_id: p.id, likes_count: Number(p.likes_count) + r.int(1, 30) } })
      }
      if (t % 5 === 0) {
        const u = pick(r, rows.users)
        if (u) {
          const tags = r.some(HASHTAGS, r.int(0, 2))
          out.push({ topic: 'posts', data: { author_id: u.id, username: u.username, display_name: u.display_name, body: `${r.pick(POST_OPENERS)} ${r.pick(POST_TOPICS)}. ${r.pick(POST_CLOSERS)}${tags.length ? ' ' + tags.map((x) => '#' + x).join(' ') : ''}`, hashtags: tags, published_at: new Date().toISOString() } })
        }
      }
      if (t % 7 === 0) {
        const u = pick(r, rows.users)
        const p = pick(r, rows.posts)
        if (u && p) out.push({ topic: 'comments', data: { post_id: p.id, author_id: u.id, username: u.username, body: r.pick(COMMENT_LINES) } })
      }
      break
    }
    case 'helpdesk': {
      if (t % 3 === 0) {
        const tk = pick(r, rows.tickets)
        if (tk) {
          const key = 'tk:' + tk.id
          const from = st.status[key] ?? String(tk.status)
          const opts = TICKET_NEXT[from]
          if (opts && r.chance(0.7)) {
            const to = r.pick(opts)
            st.status[key] = to
            out.push({ topic: 'tickets', data: { id: tk.id, number: tk.number, subject: tk.subject, status: to, previous: from, priority: tk.priority } })
          } else if (!tk.assignee_id) {
            const ag = pick(r, rows.agents)
            if (ag) out.push({ topic: 'tickets', data: { id: tk.id, number: tk.number, subject: tk.subject, status: from, assigned_to: ag.id, assignee: ag.name } })
          }
        }
      }
      if (t % 4 === 0) {
        const tk = pick(r, rows.tickets)
        const ag = pick(r, rows.agents)
        const cu = pick(r, rows.customers)
        if (tk && ag && cu) {
          const fromAgent = r.chance(0.5)
          out.push({ topic: 'messages', data: { ticket_id: tk.id, number: tk.number, author_type: fromAgent ? 'agent' : 'customer', author_name: fromAgent ? ag.name : cu.contact_name, body: fromAgent ? r.pick(AGENT_LINES) : r.pick(COMMENT_LINES), created_at: new Date().toISOString() } })
        }
      }
      break
    }
  }
  return out
}

/** The topics an API's room can publish, for the hello message. */
export function topicsOf(api: string): string[] {
  const map: Record<string, string[]> = {
    store: ['orders', 'inventory'],
    social: ['posts', 'likes', 'comments'],
    helpdesk: ['tickets', 'messages'],
  }
  return map[api] ?? []
}
