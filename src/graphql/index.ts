// /v1/{api}/graphql — POST {query, variables, operationName} (or GET
// ?query=), introspection included so a client can load the schema.

import { LiveArgs } from '../live'
import { HubError, json, readJson, html } from '../http'
import { parseDocument, GraphQLSyntaxError } from './parser'
import { schemaFor, Loader, GqlContext } from './schema'
import { execute } from './execute'
import { Ctx } from '../data/db'
import { printSchema } from './print'

export async function handleGraphql(a: LiveArgs): Promise<Response> {
  const { req, url, api } = a
  if (a.rest.length !== 1) throw new HubError(404, 'not_found', 'GraphQL lives at /v1/{api}/graphql.')
  const method = req.method.toUpperCase()
  let query: string | null = null
  let variables: Record<string, unknown> | null = null
  let operationName: string | null = null

  if (method === 'GET') {
    query = url.searchParams.get('query')
    if (url.searchParams.get('sdl') !== null || url.searchParams.get('schema') !== null) return new Response(printSchema(schemaFor(api)), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } })
    if (!query) {
      if ((req.headers.get('Accept') ?? '').includes('text/html')) return html(landing(api.name, api.title))
      return json({
        endpoint: `/v1/${api.name}/graphql`,
        how: 'POST {"query": "...", "variables": {...}} as application/json, or GET ?query=... — introspection answers the usual IntrospectionQuery, and ?sdl prints the schema.',
        try: `{ ${api.collections[0].name}(limit: 3) { data { id } total } }`,
      })
    }
    const v = url.searchParams.get('variables')
    if (v) {
      try {
        variables = JSON.parse(v)
      } catch {
        throw new HubError(400, 'bad_request', 'variables must be JSON.')
      }
    }
    operationName = url.searchParams.get('operationName')
  } else if (method === 'POST') {
    const ct = req.headers.get('Content-Type') ?? ''
    if (ct.includes('application/graphql')) query = await req.text()
    else {
      const body = (await readJson(req)) as Record<string, unknown>
      query = typeof body.query === 'string' ? body.query : null
      variables = body.variables && typeof body.variables === 'object' ? (body.variables as Record<string, unknown>) : null
      operationName = typeof body.operationName === 'string' ? body.operationName : null
    }
  } else {
    throw new HubError(405, 'method_not_allowed', 'GraphQL takes POST (JSON body) or GET (?query=).', undefined, { Allow: 'GET, POST, OPTIONS' })
  }
  if (!query || !query.trim()) return json({ errors: [{ message: 'Must provide a query string.' }] }, 400)

  let doc
  try {
    doc = parseDocument(query)
  } catch (e) {
    if (e instanceof GraphQLSyntaxError) return json({ errors: [{ message: `Syntax Error: ${e.message}`, locations: [e.loc] }] }, 400)
    throw e
  }
  const ctx: Ctx = a.ctx
  const g: GqlContext = { ctx, loader: new Loader(ctx) }
  const result = await execute(schemaFor(api), doc, variables, operationName, g)
  if (ctx.overlay.writes > 0) (result as Record<string, unknown>).extensions = { writes: ctx.overlay.writes }
  return json(result, 200, { 'Cache-Control': 'no-store' })
}

function landing(name: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sondahub-core ${title} GraphQL</title>
<style>body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;max-width:680px;margin:64px auto;line-height:1.6;color:#1c2430;padding:0 16px}code,pre{background:#eef2f7;border-radius:6px;padding:2px 6px}pre{padding:14px;overflow:auto}</style></head>
<body><h1>${title} — GraphQL</h1><p>This endpoint answers <code>POST</code> with a JSON body <code>{"query": "…", "variables": {…}}</code>, or <code>GET ?query=…</code>. Introspection works, so an API client can load the schema. <a href="?sdl">Print the schema (SDL)</a>.</p>
<pre>POST /v1/${name}/graphql
{"query": "{ __schema { queryType { fields { name } } } }"}</pre>
<p><a href="/v1/${name}">The ${title} API index.</a></p></body></html>`
}
