// End-to-end checks with real clients: REST reads and writes, the business
// rules, writes kept in memory and reset, GraphQL, WebSocket and SSE, the
// utilities and auth schemes, formats, problem details and cursors.
//
//   npm test                          # starts a server on a free port, tests it, stops it
//   HUB=http://localhost:8787 npm test   # tests a server that is already running
//   ONLY=graphql npm test             # just the sections with that in their name

import { createHash } from 'node:crypto'
import { startServer, Running } from '../src/server'

let running: Running | null = null
if (!process.env.HUB) running = await startServer({ port: 0 })
const HUB = (process.env.HUB ?? running!.url).replace(/\/$/, '')
const WSB = HUB.replace(/^http/, 'ws')
let passed = 0
let failed = 0
const dec = new TextDecoder()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ok(cond: unknown, what: string, detail?: unknown): void {
  if (cond) passed++
  else {
    failed++
    console.log(`  FAIL ${what}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''}`)
  }
}

async function j(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers ?? {})
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const r = await fetch(HUB + path, { ...init, headers, redirect: init.redirect ?? 'manual' })
  const text = await r.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: r.status, body, headers: r.headers }
}

const post = (path: string, body: unknown) => j(path, { method: 'POST', body: JSON.stringify(body) })
const patch = (path: string, body: unknown) => j(path, { method: 'PATCH', body: JSON.stringify(body) })

async function section(name: string, fn: () => Promise<void>): Promise<void> {
  if (process.env.ONLY && !name.toLowerCase().includes(process.env.ONLY.toLowerCase())) return
  const before = failed
  const t0 = Date.now()
  try {
    await fn()
  } catch (e) {
    failed++
    console.log(`  FAIL ${name} threw: ${(e as Error).message}`)
  }
  console.log(`${failed === before ? 'ok  ' : 'FAIL'} ${name} (${Date.now() - t0} ms)`)
}

await j('/v1/reset', { method: 'POST' })

await section('root and data files', async () => {
  const root = await j('/v1')
  ok(root.status === 200 && root.body.apis?.length === 3 && root.body.apis.map((a: any) => a.name).join(',') === 'store,social,helpdesk', '/v1 lists the three APIs', root.body.apis)
  ok(root.body.version && root.headers.get('x-sondahub-version') === root.body.version, 'version header matches')
  ok((await j('/')).body.name === 'sondahub-core', '/ answers the index too')
  const data = await fetch(HUB + '/data/store/products.json')
  ok(data.status === 200 && ((await data.json()) as unknown[]).length === 2000, 'a data file serves the seed')
  ok((await j('/data/store/nope.json')).status === 404, 'an unknown data file → 404')
})

await section('REST reads', async () => {
  const list = await j('/v1/store/products?limit=2&page=2&sort=-price&fields=id,name,price')
  ok(list.status === 200 && list.body.data.length === 2 && list.body.meta.total === 2000, 'paged list', list.body.meta)
  ok(list.headers.get('x-total-count') === '2000' && (list.headers.get('link') ?? '').includes('rel="next"'), 'X-Total-Count and Link headers')
  ok(Object.keys(list.body.data[0]).join(',') === 'id,name,price', 'fields projection')
  const f = await j('/v1/store/products?price_lt=20&in_stock=true&category_id_in=1,6&limit=1')
  ok(f.status === 200 && f.body.meta.total > 0 && f.body.data[0].price < 20 && f.body.data[0].in_stock === true, 'operators _lt _in and booleans', f.body.data[0])
  const nested = await j('/v1/store/customers?address.country=AR&limit=1')
  ok(nested.status === 200 && nested.body.data[0].address.country === 'AR', 'dotted filter into JSON')
  const q = await j('/v1/store/products?q=headphones&limit=1')
  ok(q.status === 200 && /headphones/i.test(q.body.data[0].name), '?q= search')
  const ex = await j('/v1/store/orders/7?expand=customer,items')
  ok(ex.status === 200 && ex.body.customer?.name && Array.isArray(ex.body.items) && ex.body.items.length > 0, 'expand belongsTo and hasMany')
  const av = await fetch(HUB + (await j('/v1/social/users/3')).body.avatar_url)
  ok(av.status === 200 && (av.headers.get('content-type') ?? '').startsWith('image/svg+xml') && (await av.text()).startsWith('<svg'), 'a user’s avatar_url serves an SVG')
  ok((await j('/v1/social/users/999999/avatar.svg')).status === 404, 'a missing user’s avatar → 404')
  const rel = await j('/v1/store/customers/5/orders?limit=2')
  ok(rel.status === 200 && rel.body.data.every((o: any) => o.customer_id === 5), 'nested route')
  ok((await j('/v1/store/products?colour=red')).body.error?.code === 'unknown_filter', 'unknown filter → 400')
  ok((await j('/v1/store/products/999999')).status === 404, 'missing id → 404')
  const e3 = await j('/v1/nope')
  ok(e3.status === 404 && /APIs are/.test(e3.body.error.message), 'unknown API → 404 with the list')
  const etag = (await j('/v1/store/products/10')).headers.get('etag')!
  ok((await j('/v1/store/products/10', { headers: { 'If-None-Match': etag } })).status === 304, 'ETag → 304')
  const oa = await j('/v1/store/openapi.json')
  ok(oa.status === 200 && oa.body.openapi === '3.0.3' && Object.keys(oa.body.paths).length > 30, 'OpenAPI document')
  for (const api of ['social', 'helpdesk']) {
    const r = await j(`/v1/${api}`)
    ok(r.status === 200 && r.body.collections.length > 0 && r.body.collections.every((c: any) => c.seed_records > 0), `${api} index`)
  }
})

await section('writes kept in memory, and validation', async () => {
  const created = await post('/v1/store/products', { sku: 'T-1', name: 'Test widget', category_id: 1, price: 12.5, tags: ['new'], in_stock: true, status: 'active' })
  ok(created.status === 201 && created.body.id === 2001 && created.body.tags[0] === 'new' && created.body.in_stock === true && created.body._note === undefined, 'create answers 201 with the record, no note', created.body)
  ok((created.headers.get('location') ?? '').endsWith('/v1/store/products/2001'), 'Location header')
  const back = await j('/v1/store/products/2001')
  ok(back.status === 200 && back.body.name === 'Test widget', 'and the next GET finds it')
  ok((await j('/v1/store/products?limit=1')).body.meta.total === 2001, 'lists count it')
  const bad = await post('/v1/store/products', { sku: 'T-2', name: 'X', category_id: 999, price: 1, status: 'nope', extra: 1 })
  ok(bad.status === 422 && bad.body.error.details.length >= 2, '422 lists each problem', bad.body)
  const refbad = await post('/v1/store/products', { sku: 'T-3', name: 'X', category_id: 999, price: 1 })
  ok(refbad.status === 422 && /category 999/.test(refbad.body.error.message), 'ref existence checked')
  const patched = await patch('/v1/store/products/1', { price: 1.99, name: 'Mine' })
  ok(patched.status === 200 && patched.body.price === 1.99 && patched.body.name === 'Mine', 'patch answers the changed record')
  ok((await j('/v1/store/products/1')).body.name === 'Mine', 'and the change is kept')
  const del = await j('/v1/store/products/2', { method: 'DELETE' })
  ok(del.status === 200 && del.body.deleted === true && del.body.id === 2 && del.body.product?.id === 2, 'delete answers what went')
  ok((await j('/v1/store/products/2')).status === 404, 'and the record is gone')
  const put = await j('/v1/store/products/1', { method: 'PUT', body: JSON.stringify({ sku: 'T-1', name: 'Replaced', category_id: 2, price: 5 }) })
  ok(put.status === 200 && put.body.name === 'Replaced' && put.body.tags === null, 'PUT replaces whole')
  ok((await j('/v1/store/products', { method: 'POST', body: '{' })).body.error?.code === 'invalid_json', 'bad JSON → 400')
  const second = await post('/v1/store/products', { sku: 'T-4', name: 'Next', category_id: 1, price: 3 })
  ok(second.body.id === 2002, 'ids continue', second.body.id)
  const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/v1/store/products', { sku: `P-${i}`, name: `Parallel ${i}`, category_id: 1, price: 1 })))
  const got = ids.map((r) => r.body.id)
  ok(ids.every((r) => r.status === 201) && new Set(got).size === 8 && Math.min(...got) === 2003 && Math.max(...got) === 2010, 'parallel writes get distinct ids', got)
  const reset = await j('/v1/reset?api=store', { method: 'POST' })
  ok(reset.status === 200 && reset.body.apis.join() === 'store', 'reset one API')
  ok((await j('/v1/store/products/2001')).status === 404 && (await j('/v1/store/products/2')).status === 200 && (await j('/v1/store/products/1')).body.name !== 'Replaced', 'and the seed is back')
  ok((await j('/v1/reset')).status === 405, 'reset takes POST only')
})

await section('business rules', async () => {
  const before = (await j('/v1/store/customers/5')).body.orders_count
  const order = await post('/v1/store/orders', { customer_id: 5, items: [{ product_id: 3, quantity: 2 }, { product_id: 4 }], shipping_method: 'express' })
  ok(order.status === 201 && order.body.items.length === 2 && order.body.total > 0 && /^SH-/.test(order.body.number), 'order with items', order.body)
  ok((await j(`/v1/store/orders/${order.body.id}/items`)).body.meta.total === 2, 'its items are kept')
  ok((await j('/v1/store/customers/5')).body.orders_count === before + 1, 'the customer counts the order')
  const failing = await post('/v1/store/orders', { customer_id: 5, items: [{ product_id: 3 }, { product_id: 99999 }] })
  ok(failing.status === 422, 'an order with a missing product → 422')
  ok((await j('/v1/store/customers/5')).body.orders_count === before + 1, 'and a failed request changes nothing')
  const ship = await patch('/v1/store/orders/1', { status: 'shipped' })
  ok(ship.status === 200 && ship.body.status === 'shipped' && ship.body.tracking_number, 'shipping stamps', ship.body)
  const closedTicket = await j('/v1/helpdesk/tickets?status=closed&limit=1')
  const tid = closedTicket.body.data[0].id
  const badMove = await patch(`/v1/helpdesk/tickets/${tid}`, { status: 'pending' })
  ok(badMove.status === 422 && badMove.body.error.code === 'invalid_transition', 'ticket transition refused')
  ok((await patch(`/v1/helpdesk/tickets/${tid}`, { status: 'open' })).body.status === 'open', 'ticket reopened')
  const existingLike = (await j('/v1/social/likes?limit=1')).body.data[0]
  ok((await post('/v1/social/likes', { user_id: existingLike.user_id, post_id: existingLike.post_id })).status === 409, 'duplicate like → 409')
  const self = await post('/v1/social/follows', { follower_id: 3, followee_id: 3 })
  ok(self.status === 422 && self.body.error.message === 'A user cannot follow the same user.', 'following the same user → 422', self.body)
  const u = (await j('/v1/social/users/7')).body.posts_count
  const p = await post('/v1/social/posts', { author_id: 7, body: 'Hello from the tests' })
  ok(p.status === 201 && (await j('/v1/social/users/7')).body.posts_count === u + 1, 'a post counts on its author')
  await j('/v1/reset', { method: 'POST' })
})

await section('GraphQL', async () => {
  const gql = async (api: string, query: string, variables?: unknown) => (await post(`/v1/${api}/graphql`, { query, variables })).body
  const intro = await gql('social', `{ __schema { queryType { name } mutationType { name } types { kind name fields { name } inputFields { name } enumValues { name } } } }`)
  ok(!intro.errors && intro.data.__schema.types.length > 40 && intro.data.__schema.types.some((t: any) => t.name === 'PostFilter'), 'introspection', intro.errors)
  const q = await gql('social', `query F($n: Int!, $tag: String) { posts(limit: $n, sort: "-likes_count", filter: { hashtags_like: $tag }) { total data { id author { username posts(limit: 1) { id } } comments(limit: 1) { author { username } } } } me: user(id: 1) { username __typename } }`, { n: 2, tag: 'coffee' })
  ok(!q.errors && q.data.posts.data.length === 2 && q.data.posts.data[0].author.username && q.data.me.__typename === 'User', 'nested query with variables', q.errors)
  const s = await gql('store', `{ orders(limit: 1, filter: { status: shipped, total_gte: 500 }) { data { number customer { name } items { sku product { category { name } } } } } }`)
  ok(!s.errors && s.data.orders.data[0].items[0].product.category.name, 'relations three deep', s.errors)
  ok((await gql('store', `{ products(limit: 1) { data { nope } } }`)).errors?.[0]?.message.includes('Cannot query field "nope"'), 'unknown field error')
  const m = await gql('store', `mutation ($in: ProductInput!) { createProduct(input: $in) { id sku } }`, { in: { sku: 'G-1', name: 'From GraphQL', category_id: 1, price: 2 } })
  ok(!m.errors && m.data.createProduct.id === 2001 && m.extensions?.writes === 1, 'mutation creates', m)
  ok((await j('/v1/store/products/2001')).body.sku === 'G-1', 'and REST sees it')
  const bad = await gql('store', `mutation { createProduct(input: { sku: "x", name: "y", category_id: 999, price: 1 }) { id } }`)
  ok(bad.errors?.[0]?.extensions?.code === 'validation_failed', 'mutation validation error carries the code')
  const sdl = await (await fetch(`${HUB}/v1/helpdesk/graphql?sdl`)).text()
  ok(sdl.includes('type Ticket') && sdl.includes('input TicketFilter'), 'SDL prints')
  await j('/v1/reset', { method: 'POST' })
})

function wsConnect(url: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const msgs: any[] = []
    ws.addEventListener('message', (e) => msgs.push(e.data))
    ws.addEventListener('open', () => resolve({ ws, msgs }))
    ws.addEventListener('error', () => reject(new Error('ws error ' + url)))
  })
}
const pj = (m: any) => (typeof m === 'string' ? JSON.parse(m) : m)

await section('WebSocket and SSE streams', async () => {
  const [store, social] = await Promise.all([wsConnect(`${WSB}/v1/store/ws`), wsConnect(`${WSB}/v1/social/ws?topics=likes`)])
  const ctl = new AbortController()
  const sseRead = (async () => {
    const res = await fetch(`${HUB}/v1/helpdesk/events`, { signal: ctl.signal })
    const reader = res.body!.getReader()
    let text = ''
    const t0 = Date.now()
    try {
      while (Date.now() - t0 < 4600) {
        const { value, done } = await reader.read()
        if (done) break
        text += dec.decode(value)
      }
    } catch {
      /* aborted */
    }
    return { type: res.headers.get('content-type') ?? '', text }
  })()
  await sleep(4400)
  ok(pj(store.msgs[0]).type === 'hello', 'hello first', store.msgs[0])
  ok(store.msgs.slice(1).map(pj).some((e) => e.type === 'event' && (e.topic === 'orders' || e.topic === 'inventory')), 'store activity arrives')
  store.ws.send(JSON.stringify({ type: 'ping' }))
  store.ws.send(JSON.stringify({ type: 'subscribe', topics: ['orders'] }))
  store.ws.send('plain text')
  await sleep(300)
  const tail = store.msgs.slice(-3).map(pj)
  ok(tail.some((t) => t.type === 'pong') && tail.some((t) => t.type === 'subscribed') && tail.some((t) => t.type === 'echo'), 'ping, subscribe and echo answered', tail)
  store.ws.close()
  const likes = social.msgs.slice(1).map(pj)
  ok(likes.length >= 2 && likes.every((e) => e.topic === 'likes'), '?topics= narrows the stream', likes.length)
  social.ws.close()
  const sse = await sseRead
  ctl.abort()
  ok(sse.type.includes('text/event-stream') && sse.text.includes('id: 1') && /event: (tickets|messages)/.test(sse.text), 'SSE streams the helpdesk', sse.text.slice(0, 160))
  ok((await j('/v1/social/ws?topics=nope')).status === 400, 'unknown topic → 400')
  ok((await j('/v1/store/ws')).status === 426, 'plain GET on /ws → 426')
  const echo = await wsConnect(`${WSB}/v1/utils/ws`)
  echo.ws.send('hello')
  echo.ws.send(new Uint8Array([1, 2, 3]))
  await sleep(300)
  ok(echo.msgs[0] === 'hello' && new Uint8Array(echo.msgs[1]).join(',') === '1,2,3', 'echo text and binary', echo.msgs.length)
  echo.ws.close()
})

await section('utilities', async () => {
  const echo = await j('/v1/utils/echo?a=1&a=2', { method: 'POST', body: JSON.stringify({ hi: 1 }) })
  ok(echo.body.method === 'POST' && echo.body.query.a.length === 2 && echo.body.body.hi === 1, 'echo')
  ok((await j('/v1/utils/post')).status === 405, '/post with GET → 405')
  ok((await j('/v1/utils/status/418')).status === 418, 'status 418')
  ok((await j('/v1/utils/status/204')).status === 204, 'status 204')
  const t0 = Date.now()
  ok((await j('/v1/utils/delay/0.3')).status === 200 && Date.now() - t0 >= 280, 'delay waits')
  const red = await j('/v1/utils/redirect/2')
  ok(red.status === 302 && (red.headers.get('location') ?? '').includes('/redirect/1'), 'redirect chain')
  ok((await j('/v1/utils/redirect-to?url=https://evil.example/')).status === 400, 'off-host redirect refused')
  const setc = await j('/v1/utils/cookies/set?flavor=choc')
  ok(setc.status === 302 && (setc.headers.get('set-cookie') ?? '').includes('flavor=choc'), 'set cookie')
  const jar = await j('/v1/utils/cookies', { headers: { Cookie: 'flavor=choc; n=2' } })
  ok(jar.body.cookies.flavor === 'choc' && jar.body.cookies.n === '2', 'read cookies')
  const gz = await fetch(HUB + '/v1/utils/gzip')
  ok(gz.status === 200 && ((await gz.json()) as any).gziped === true, 'gzip body decodes')
  const rng = await fetch(HUB + '/v1/utils/range/100', { headers: { Range: 'bytes=10-19' } })
  ok(rng.status === 206 && (await rng.text()) === 'klmnopqrst', 'range 206')
  const png = new Uint8Array(await (await fetch(HUB + '/v1/utils/image/png?w=8&h=8')).arrayBuffer())
  ok(png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71, 'PNG signature')
  ok((await j('/v1/utils/cache', { headers: { 'If-None-Match': '"sondahub-cache-v1"' } })).status === 304, 'cache 304')
  const fd = new FormData()
  fd.append('name', 'Ada')
  fd.append('file', new Blob(['file content here']), 'up.txt')
  const up = await fetch(HUB + '/v1/utils/forms/post', { method: 'POST', body: fd })
  const upb: any = await up.json()
  ok(up.status === 200 && upb.fields.name === 'Ada' && upb.files[0].size === 17 && upb.files[0].sha256 === createHash('sha256').update('file content here').digest('hex'), 'multipart upload')
  const sse = await fetch(HUB + '/v1/utils/sse?count=2&interval=50', { headers: { 'Last-Event-ID': '7' } })
  const sseText = await sse.text()
  ok(sse.status === 200 && sseText.includes('id: 8') && sseText.includes('id: 9') && sseText.includes('event: done'), 'SSE clock with resume')
  ok((await (await fetch(HUB + '/v1/utils/stream/3?interval=10')).text()).trim().split('\n').length === 3, 'NDJSON stream')
  ok((await j('/v1/utils/hash/md5?text=sonda')).body.hex === createHash('md5').update('sonda').digest('hex'), 'md5 matches node')
  ok((await j('/v1/utils/ip')).body.ip, 'ip')
  const idx = await j('/v1/utils')
  ok(idx.status === 200 && idx.body.groups.length >= 6 && Object.keys(idx.body.credentials).join() === 'username,password,api_key', 'the utilities index')
})

await section('auth schemes', async () => {
  const basic = await j('/v1/utils/auth/basic', { headers: { Authorization: 'Basic ' + Buffer.from('sonda:probe').toString('base64') } })
  ok(basic.status === 200 && basic.body.authenticated, 'basic ok')
  const basicBad = await j('/v1/utils/auth/basic', { headers: { Authorization: 'Basic ' + Buffer.from('sonda:nope').toString('base64') } })
  ok(basicBad.status === 401 && (basicBad.headers.get('www-authenticate') ?? '').startsWith('Basic'), 'basic wrong → 401 + challenge')
  ok((await j('/v1/utils/auth/hidden-basic/a/b')).status === 404, 'hidden-basic → 404')
  ok((await j('/v1/utils/auth/bearer', { headers: { Authorization: 'Bearer x' } })).status === 200, 'bearer any')
  ok((await j('/v1/utils/auth/bearer/right', { headers: { Authorization: 'Bearer wrong' } })).status === 401, 'bearer exact')
  ok((await j('/v1/utils/auth/apikey', { headers: { 'X-API-Key': 'sonda-probe-key' } })).status === 200, 'api key header')
  ok((await j('/v1/utils/auth/apikey?api_key=bad')).status === 403, 'api key wrong → 403')
  const ch = await j('/v1/utils/auth/digest?algorithm=MD5&qop=auth')
  const nonce = /nonce="([^"]+)"/.exec(ch.headers.get('www-authenticate') ?? '')![1]
  const H = (s: string) => createHash('md5').update(s).digest('hex')
  const uri = '/v1/utils/auth/digest?algorithm=MD5&qop=auth'
  const resp = H(`${H('sonda:sondahub:probe')}:${nonce}:00000001:abc:auth:${H('GET:' + uri)}`)
  const dg = await j(uri, { headers: { Authorization: `Digest username="sonda", realm="sondahub", nonce="${nonce}", uri="${uri}", qop=auth, nc=00000001, cnonce="abc", response="${resp}", algorithm=MD5` } })
  ok(dg.status === 200 && dg.body.scheme === 'digest', 'digest MD5 by hand', dg.body)
  const dgBad = await j(uri, { headers: { Authorization: `Digest username="sonda", realm="sondahub", nonce="${nonce}", uri="${uri}", qop=auth, nc=00000001, cnonce="abc", response="0000", algorithm=MD5` } })
  ok(dgBad.status === 401 && /does not match/.test(dgBad.body.error.message), 'digest wrong → 401 with reason')
})

await section('formats, problem details, cursors, CORS', async () => {
  const types: [string, string][] = [['csv', 'text/csv'], ['xml', 'application/xml'], ['yaml', 'application/yaml'], ['ndjson', 'application/x-ndjson'], ['msgpack', 'application/msgpack']]
  for (const [f, t] of types) {
    const r = await fetch(`${HUB}/v1/store/products?limit=2&fields=id,name&format=${f}`)
    ok(r.status === 200 && (r.headers.get('content-type') ?? '').startsWith(t), `?format=${f}`, r.headers.get('content-type'))
  }
  const csv = await (await fetch(`${HUB}/v1/store/products?limit=2&fields=id,price`, { headers: { Accept: 'text/csv' } })).text()
  ok(csv.split(/\r?\n/)[0] === 'id,price' && csv.trim().split(/\r?\n/).length === 3, 'Accept: text/csv', csv)
  const prob = await j('/v1/store/products/999999', { headers: { Accept: 'application/problem+json' } })
  ok(prob.status === 404 && prob.headers.get('content-type')?.startsWith('application/problem+json') && prob.body.type?.endsWith('/v1/problems/not_found') && prob.body.status === 404, 'problem+json', prob.body)
  ok((await j(new URL(prob.body.type).pathname)).status === 200, 'the problem type resolves')
  const c1 = await j('/v1/store/products?paging=cursor&limit=2&fields=id')
  const c2 = await j(`/v1/store/products?limit=2&fields=id&cursor=${c1.body.meta.next_cursor}`)
  ok(c1.body.meta.has_more === true && c2.body.data[0].id === 3 && c2.body.meta.prev_cursor, 'cursor paging', c2.body.meta)
  ok((await j(`/v1/store/products?limit=2&sort=-price&cursor=${c1.body.meta.next_cursor}`)).status === 400, 'a cursor from another query → 400')
  ok((await j('/v1/store/products?starting_after=10&limit=1&fields=id')).body.data[0]?.id === 11, 'starting_after')
  const pre = await fetch(`${HUB}/v1/store/products`, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } })
  ok(pre.status === 204 && /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''), 'preflight names Authorization', pre.headers.get('access-control-allow-headers'))
})

await section('only the core answers', async () => {
  for (const path of ['/v1/bank', '/v1/fleet', '/v1/flights', '/v1/identity', '/v1/utils/oauth/token', '/v1/utils/jwt/issue', '/v1/utils/webhooks', '/v1/utils/auth/sigv4', '/v1/utils/flaky', '/mcp', '/fhir/metadata', '/soap/store', '/v1/mock'])
    ok((await j(path)).status === 404, `${path} → 404`)
  const write = await post('/v1/store/carts', { customer_id: 1 })
  ok(!write.headers.get('x-sondahub-session') && !write.headers.get('x-sondahub-write'), 'no session or simulated-write headers')
  await j('/v1/reset', { method: 'POST' })
})

console.log(`\n${passed} passed, ${failed} failed`)
await running?.close()
process.exit(failed ? 1 : 0)
