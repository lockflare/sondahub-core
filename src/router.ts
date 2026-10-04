// sondahub-core: every request comes through handle(), which routes it and
// runs the pipeline around the answer (src/pipeline.ts: formats, problem
// details).
//
//   /, /v1                          the index
//   /v1/{api}                       an API's index
//   /v1/{api}/{collection}…         REST
//   /v1/{api}/openapi.json          its OpenAPI 3 document
//   /v1/{api}/graphql               GraphQL
//   /v1/{api}/ws, /v1/{api}/events  its live activity over WebSocket and SSE
//   /v1/utils/…                     HTTP test endpoints and auth schemes
//   /v1/problems/{code}             what a problem+json "type" points at
//   /v1/reset                       POST: back to the seed (?api= for one API)
//   /data/{api}/{collection}.json   a collection's seed, as one file
//
// Reads see the seed with the kept writes. A write runs on a copy of the
// kept writes, one write at a time, and the copy is kept only when the
// answer is a success.

import { publicOrigin } from './env'
import { HubError, errorResponse, json, notFound, baseHeaders, CORS_HEADERS } from './http'
import { APIS, findApi } from './registry'
import { Api, findCollection } from './registry/types'
import { Ctx, keptWrites, keep, reset, oneAtATime, seedRows, seedCount } from './data/db'
import { handleRest } from './rest/handlers'
import { handleUtils } from './utils'
import { handleLive } from './live'
import { handleGraphql } from './graphql'
import { controls, finish, Controls } from './pipeline'
import { PROBLEMS } from './problems'
import { APP_VERSION } from './version'

function toError(e: unknown): Response {
  if (e instanceof HubError) return errorResponse(e)
  const msg = e instanceof Error ? e.message : String(e)
  console.error('unhandled', msg, e instanceof Error ? e.stack : '')
  return errorResponse(new HubError(500, 'internal_error', 'Something broke on our side: ' + msg))
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') {
    // the * wildcard does not cover Authorization, so name what the browser asked for
    const h = new Headers(CORS_HEADERS)
    const asked = req.headers.get('Access-Control-Request-Headers')
    if (asked) h.set('Access-Control-Allow-Headers', `${asked}, *`)
    return new Response(null, { status: 204, headers: h })
  }
  const base = publicOrigin(url)
  let c: Controls
  try {
    c = controls(req, url)
  } catch (e) {
    return toError(e)
  }
  let res: Response
  try {
    res = await route(req, url)
  } catch (e) {
    res = toError(e)
  }
  return finish(res, req, url, base, c)
}

async function route(req: Request, url: URL): Promise<Response> {
  const path = url.pathname
  if (path === '/' || path === '/v1' || path === '/v1/') return root(url)
  if (path.startsWith('/data/')) return dataFile(path)
  if (!path.startsWith('/v1/')) throw notFound('Everything is under /v1. GET /v1 lists it.')
  const segments = path.split('/').filter(Boolean).slice(1)
  const head = segments[0]
  if (head === 'utils') return handleUtils({ req, url, rest: segments.slice(1) })
  if (head === 'problems') return problem(url, segments[1])
  if (head === 'reset') return resetRoute(req, url)
  const api = findApi(head)
  if (!api) throw notFound(`No API called "${head}". The APIs are: ${APIS.map((a) => a.name).join(', ')}, and utils.`)
  return apiRoute(req, url, api, segments.slice(1))
}

async function apiRoute(req: Request, url: URL, api: Api, rest: string[]): Promise<Response> {
  const dispatch = (ctx: Ctx): Promise<Response> => {
    if (rest[0] === 'ws' || rest[0] === 'events') return handleLive({ req, ctx, url, api, rest })
    if (rest[0] === 'graphql') return handleGraphql({ req, ctx, url, api, rest })
    return handleRest({ req, ctx, url, api, rest })
  }
  const method = req.method.toUpperCase()
  const live = rest[0] === 'ws' || rest[0] === 'events'
  if (method === 'GET' || method === 'HEAD' || live) return dispatch({ api, overlay: keptWrites(api.name) })
  return oneAtATime(async () => {
    const ctx: Ctx = { api, overlay: keptWrites(api.name).copy() }
    const res = await dispatch(ctx)
    if (res.status < 400 && ctx.overlay.writes > 0) keep(api.name, ctx.overlay)
    return res
  })
}

async function resetRoute(req: Request, url: URL): Promise<Response> {
  if (req.method !== 'POST') throw new HubError(405, 'method_not_allowed', 'POST /v1/reset puts the seed back (?api=store for one API).', undefined, { Allow: 'POST, OPTIONS' })
  const name = url.searchParams.get('api')
  if (name && !findApi(name)) throw notFound(`No API called "${name}". The APIs are: ${APIS.map((a) => a.name).join(', ')}.`)
  await oneAtATime(async () => reset(name ?? undefined))
  return json({ reset: true, apis: name ? [name] : APIS.map((a) => a.name) })
}

/** /data/{api}/{collection}.json: the collection's seed, as generated. */
function dataFile(path: string): Response {
  const m = /^\/data\/([a-z_]+)\/([a-z_]+)\.json$/.exec(path)
  const api = m ? findApi(m[1]) : undefined
  const c = api && m ? findCollection(api, m[2]) : undefined
  if (!api || !c) throw notFound(`Data files are /data/{api}/{collection}.json, for example /data/${APIS[0].name}/${APIS[0].collections[0].name}.json.`)
  const h = baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  return new Response(JSON.stringify(seedRows(api, c)), { status: 200, headers: h })
}

/** /v1/problems/{code}: what a problem+json "type" points at. */
function problem(url: URL, code?: string): Response {
  const base = publicOrigin(url)
  if (!code) return json({ problems: Object.entries(PROBLEMS).map(([k, v]) => ({ type: `${base}/v1/problems/${k}`, title: v[0], status: v[1] })) })
  const p = PROBLEMS[code]
  return json({ type: `${base}/v1/problems/${code}`, title: p?.[0] ?? code.replace(/_/g, ' '), status: p?.[1] ?? null, description: p?.[2] ?? 'A problem the server reports; the detail of each answer says what happened.' })
}

function root(url: URL): Response {
  const base = publicOrigin(url)
  const wsb = base.replace(/^http/, 'ws')
  return json({
    name: 'sondahub-core',
    version: APP_VERSION,
    description: 'Mock APIs that answer like real ones: populated, related data over REST, GraphQL, WebSocket and SSE, with validation, business rules and writes that stick in memory.',
    apis: APIS.map((a) => ({
      name: a.name,
      title: a.title,
      description: a.tagline,
      url: `${base}/v1/${a.name}`,
      openapi: `${base}/v1/${a.name}/openapi.json`,
      graphql: `${base}/v1/${a.name}/graphql`,
      websocket: `${wsb}/v1/${a.name}/ws`,
      sse: `${base}/v1/${a.name}/events`,
      data: `${base}/data/${a.name}/`,
      records: a.collections.reduce((s, c) => s + seedCount(a, c), 0),
    })),
    utils: `${base}/v1/utils`,
    problems: `${base}/v1/problems`,
    writes: 'POST, PUT, PATCH and DELETE are validated, run through the rules and kept in memory until the server stops. A request that fails changes nothing. POST /v1/reset puts the seed back.',
    controls: {
      Accept: 'text/csv, application/xml, application/yaml, application/x-ndjson, application/msgpack, application/problem+json',
      paging: 'page/limit, offset, cursor, starting_after/ending_before',
    },
    hosted: 'https://sondahub.com',
  })
}
