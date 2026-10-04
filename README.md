# sondahub-core

Mock APIs that answer like real ones. Three populated, related worlds — an online **Store**, a **Social** network and a **Helpdesk**, about 54,000 records in all — over REST, GraphQL, WebSocket and Server-Sent Events, with real validation, business rules and writes that stick. Plus a set of HTTP test endpoints for everything a client has to get right that is not a business API.

sondahub-core is a curated version of [sondahub](https://sondahub.com), released under the MIT License. No database, no accounts, no keys, no runtime dependencies: one Node process.

## Quick start

Needs Node 22 or newer.

    npm install
    npm run dev                # http://localhost:8787 — GET /v1 lists everything

For a build that runs on plain Node:

    npm run build              # dist/sondahub-core.js, one file
    npm start

    npm test                   # starts a server on a free port, runs every check against it, stops it

## The worlds

| API | Collections | Records |
| --- | --- | --- |
| `store` | categories, products, customers, orders, order_items, reviews, warehouses, inventory, carts | 20,730 |
| `social` | users, posts, comments, likes, follows | 25,800 |
| `helpdesk` | teams, agents, customers, tickets, messages | 7,398 |

The data is generated when the server starts, from a fixed seed: the same rows with the same ids every time, so record 1 is record 1 in every test run. Every collection is also one file at `/data/{api}/{collection}.json`.

## REST

    GET    /v1/store/products?price_lt=20&in_stock=true&sort=-price&limit=5
    GET    /v1/store/orders/7?expand=customer,items
    GET    /v1/store/customers/5/orders
    POST   /v1/store/orders              {"customer_id": 5, "items": [{"product_id": 3, "quantity": 2}]}
    PATCH  /v1/helpdesk/tickets/12       {"status": "resolved"}
    DELETE /v1/social/posts/40

Lists answer `{"data": [...], "meta": {"page", "limit", "total", "pages"}}` with `X-Total-Count` and an RFC 8288 `Link` header.

- **Filters:** one per field, `?status=paid`, with the operators `_ne _gt _gte _lt _lte _like _in _null` (`?price_lt=20`, `?category_id_in=1,6`); dotted names reach into JSON fields (`?address.country=AR`).
- **Search, sort, shape:** `q` searches the text fields; `sort=-price,name`; `fields=id,name` keeps only those; `expand=customer,items` embeds related records, both directions.
- **Paging:** `page` and `limit` (up to 200), or `offset`; `paging=cursor` for opaque cursors; `starting_after` / `ending_before` with an id.
- **Caching:** every record and list carries a weak `ETag`; `If-None-Match` earns a 304.
- **OpenAPI:** each API publishes an OpenAPI 3 document at `/v1/{api}/openapi.json`, with schemas and examples, ready to import into an API client.

### Writes

POST, PUT, PATCH and DELETE are validated and run through each world's rules, then kept in memory:

- a wrong body answers 422 with one line per problem, and a reference to a record that does not exist is refused;
- an order prices its items, totals itself and counts on its customer; shipping stamps a tracking number;
- a ticket only moves along its allowed statuses; a like counts once; a post counts on its author.

A request that fails part way changes nothing. Writes run one at a time, so ids never clash; reads never wait. Everything lives until the server stops, or until `POST /v1/reset` puts the seed back (`?api=store` for one API) — handy between test runs.

## GraphQL

`/v1/{api}/graphql` takes `POST {"query", "variables", "operationName"}` or `GET ?query=`. Introspection works, so GraphQL tools load the schema; `?sdl` prints it. Relations nest both ways, every list takes the same filters, sorting and paging as REST, and mutations go through the same validation and rules — a record created over GraphQL is there over REST.

    { posts(limit: 2, sort: "-likes_count") { total data { body author { username } comments(limit: 3) { body } } } }

## Live streams

Each API's own activity — orders moving and stock changing, posts and likes, tickets and messages — ticks once a second:

- **WebSocket** at `/v1/{api}/ws`: a hello, then events. Send `{"type":"subscribe","topics":["orders"]}` to narrow, `{"type":"ping"}` for a pong; anything else is echoed.
- **SSE** at `/v1/{api}/events`: the same events with ids, heartbeats and `Last-Event-ID` resumption.
- `?topics=` picks topics from the start. `/v1/utils/ws` is a plain echo socket.

## HTTP test endpoints

Under `/v1/utils` (`GET /v1/utils` lists them all): request echo, any status code, delays, redirects, cookies, sample JSON, XML and HTML, gzip and deflate, byte streams and ranges, NDJSON streams and drips, generated images, base64, hashes, caching and ETags, response headers on demand, multipart uploads, an SSE clock and a WebSocket echo.

Auth, checked for real: HTTP Basic, Digest (MD5 and SHA-256, `auth` and `auth-int`), API key and Bearer. The playground credentials are `sonda` / `probe` and the key `sonda-probe-key`. They protect nothing; set `SONDAHUB_USER`, `SONDAHUB_PASSWORD` and `SONDAHUB_API_KEY` to use others.

## Formats and errors

Any JSON answer to a GET comes in another format with `Accept` or `?format=`: CSV, XML, YAML, NDJSON or MessagePack. Errors are `{"error": {"code", "message", "details"}}`; with `Accept: application/problem+json` they come as RFC 9457 problem details, and each `type` resolves at `/v1/problems/{code}`. CORS is open to every origin.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | The port to listen on. |
| `HOST` | `127.0.0.1` | The address to listen on; `0.0.0.0` for every interface, as in a container. |
| `PUBLIC_URL` | the request's origin | The address links in answers are built on, behind a proxy. |
| `QUIET` | — | `1` turns off the line per request. |

## Layout

    src/main.ts          starts the server from the environment
    src/server.ts        the Node HTTP server and the WebSocket bridge
    src/router.ts        the routes, and the write path that keeps a write only when it succeeds
    src/pipeline.ts      other formats and problem details around every answer
    src/registry/        the source of truth: each API's collections, fields, relations and docs,
                         and its deterministic generator
    src/gen/             the seeded random generator and word lists the generators use
    src/data/            the in-memory data (db.ts), query parsing and cursors, validation,
                         create/update/delete with the rules (ops.ts)
    src/rest/            the REST handler, the business rules (hooks.ts), the OpenAPI documents
    src/graphql/         a dependency-free GraphQL: parser, schema from the registry, executor
    src/live/            the WebSocket and SSE streams and their activity
    src/utils/           the HTTP test endpoints and the auth schemes
    src/ws.ts            the socket pair the handlers and the server share
    test/test.ts         the end-to-end suite

Dev dependencies only: TypeScript, tsx, esbuild and @types/node.

## More

[sondahub.com](https://sondahub.com) runs the full hub, free: more worlds, more protocols, vendor sandboxes and testing tools, nothing to install. It is the playground for [LockFlare Sonda](https://lockflare.com/sonda), an API client.

## License

MIT — see [LICENSE](LICENSE). The code is yours to use; the names are not part of the license — see [TRADEMARKS.md](TRADEMARKS.md).
