// The live protocols, one connection at a time: each WebSocket or SSE
// stream gets its own run of the API's synthetic activity, ticking once a
// second — subscribe/ping/echo on the socket, the same events as SSE with
// ids and heartbeats. Plus an echo socket for testing a client.

import { Api } from '../registry/types'
import { Ctx } from '../data/db'
import { HubError, baseHeaders, notFound } from '../http'
import { SocketPair, upgradeResponse, isUpgrade } from '../ws'
import { loadSample, tickEvents, topicsOf, newFeedState, FeedState, Sample } from './feeds'

export interface LiveArgs {
  req: Request
  ctx: Ctx
  url: URL
  api: Api
  rest: string[]
}

const TICK_MS = 1000

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** /v1/{api}/ws and /v1/{api}/events */
export async function handleLive(a: LiveArgs): Promise<Response> {
  const { req, url, api, rest } = a
  if (rest.length !== 1) throw notFound()
  const topicsParam = url.searchParams.get('topics')
  const topics = topicsParam ? topicsParam.split(',').map((s) => s.trim()).filter(Boolean) : null
  const known = topicsOf(api.name)
  if (topics) {
    const bad = topics.filter((t) => !known.includes(t))
    if (bad.length) throw new HubError(400, 'unknown_topics', `Unknown topics: ${bad.join(', ')}. ${api.title} has: ${known.join(', ')}.`)
  }
  const sample = await loadSample(a.ctx, api.name)
  if (rest[0] === 'ws') {
    if (!isUpgrade(req)) throw new HubError(426, 'upgrade_required', `This address speaks WebSocket: connect to ${url.origin.replace(/^http/, 'ws')}${url.pathname}. The same stream over SSE is at /v1/${api.name}/events.`, undefined, { Upgrade: 'websocket' })
    return feedSocket(req, api, sample, topics)
  }
  return feedSse(req, api, sample, topics)
}

function feedSocket(req: Request, api: Api, sample: Sample, initial: string[] | null): Response {
  const pair = new SocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()
  const known = topicsOf(api.name)
  let subscribed: string[] | null = initial
  const state: FeedState = newFeedState(api.name)
  const send = (m: unknown) => {
    try {
      server.send(JSON.stringify(m))
    } catch {
      stop()
    }
  }
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const events = tickEvents(api.name, sample, state)
    const ts = new Date().toISOString()
    for (const e of events) if (!subscribed || subscribed.includes(e.topic)) send({ type: 'event', topic: e.topic, api: api.name, ts, data: e.data })
  }, TICK_MS)
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  send({ type: 'hello', api: api.name, topics: known, subscribed: subscribed ?? known, tick_ms: TICK_MS, hint: 'Send {"type":"subscribe","topics":["…"]} to narrow, {"type":"ping"} for a pong; anything else is echoed. Each connection gets its own stream.' })
  server.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') {
      send({ type: 'echo', binary_bytes: ev.data.byteLength })
      return
    }
    const j = tryJson(ev.data) as Record<string, unknown> | null
    if (!j || typeof j !== 'object') {
      send({ type: 'echo', received: ev.data })
      return
    }
    switch (j.type) {
      case 'ping':
        send({ type: 'pong', ts: new Date().toISOString(), tick: state.tick })
        break
      case 'subscribe': {
        const want = Array.isArray(j.topics) ? (j.topics as unknown[]).map(String) : typeof j.topic === 'string' ? [j.topic] : []
        const bad = want.filter((t) => !known.includes(t))
        if (bad.length) {
          send({ type: 'error', message: `Unknown topics: ${bad.join(', ')}. This stream has: ${known.join(', ')}.` })
          break
        }
        subscribed = [...new Set([...(subscribed ?? []), ...want])]
        if (!subscribed.length) subscribed = null
        send({ type: 'subscribed', topics: subscribed ?? known })
        break
      }
      case 'unsubscribe': {
        const drop = Array.isArray(j.topics) ? (j.topics as unknown[]).map(String) : typeof j.topic === 'string' ? [j.topic] : []
        subscribed = (subscribed ?? known).filter((t) => !drop.includes(t))
        send({ type: 'subscribed', topics: subscribed })
        break
      }
      case 'topics':
        send({ type: 'topics', available: known, subscribed: subscribed ?? known })
        break
      default:
        send({ type: 'echo', received: j })
    }
  })
  server.addEventListener('close', stop)
  server.addEventListener('error', stop)
  const headers: Record<string, string> = {}
  const proto = req.headers.get('Sec-WebSocket-Protocol')
  if (proto) headers['Sec-WebSocket-Protocol'] = proto.split(',')[0].trim()
  return upgradeResponse(client, headers)
}

function feedSse(req: Request, api: Api, sample: Sample, subscribed: string[] | null): Response {
  const enc = new TextEncoder()
  const state: FeedState = newFeedState(api.name)
  let id = parseInt(req.headers.get('Last-Event-ID') ?? '0', 10) || 0
  let timer: ReturnType<typeof setInterval> | null = null
  let beat: ReturnType<typeof setInterval> | null = null
  const body = new ReadableStream({
    start(controller) {
      const push = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          stop()
        }
      }
      const stop = () => {
        if (timer) clearInterval(timer)
        if (beat) clearInterval(beat)
        timer = beat = null
      }
      push(`retry: 3000\n: sondahub-core ${api.name} — the API's own activity, one tick a second${subscribed ? `, topics ${subscribed.join(',')}` : ''}\n\n`)
      timer = setInterval(() => {
        const events = tickEvents(api.name, sample, state)
        const ts = new Date().toISOString()
        for (const e of events) {
          if (subscribed && !subscribed.includes(e.topic)) continue
          id++
          push(`id: ${id}\nevent: ${e.topic}\ndata: ${JSON.stringify({ type: 'event', topic: e.topic, api: api.name, ts, data: e.data })}\n\n`)
        }
      }, TICK_MS)
      beat = setInterval(() => push(`: ping ${new Date().toISOString()}\n\n`), 15000)
    },
    cancel() {
      if (timer) clearInterval(timer)
      if (beat) clearInterval(beat)
    },
  })
  return new Response(body, { status: 200, headers: baseHeaders({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }) })
}

/** /v1/utils/ws — every frame comes straight back. */
export function echoSocket(req: Request, url: URL): Response {
  if (!isUpgrade(req)) throw new HubError(426, 'upgrade_required', `This address speaks WebSocket: connect to ${url.origin.replace(/^http/, 'ws')}${url.pathname}.`, undefined, { Upgrade: 'websocket' })
  const pair = new SocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()
  server.addEventListener('message', (ev) => {
    try {
      server.send(ev.data)
    } catch {
      /* closed */
    }
  })
  const headers: Record<string, string> = {}
  const proto = req.headers.get('Sec-WebSocket-Protocol')
  if (proto) headers['Sec-WebSocket-Protocol'] = proto.split(',')[0].trim()
  return upgradeResponse(client, headers)
}
