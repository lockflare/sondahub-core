// The utilities, listed once: GET /v1/utils and the docs both read this.

import { CREDS } from './creds'

export interface UtilEntry {
  method: string
  path: string
  doc: string
  /** A body or headers hint for the docs. */
  hint?: string
}

export interface UtilGroup {
  name: string
  slug: string
  doc: string
  entries: UtilEntry[]
}

export const UTIL_GROUPS: UtilGroup[] = [
  {
    name: 'Inspect a request',
    slug: 'inspect',
    doc: 'See exactly what arrived: method, path, query, headers and body, parsed.',
    entries: [
      { method: 'ANY', path: '/v1/utils/echo', doc: 'Answers with everything about the request: method, URL, query (repeated keys become arrays), headers, the body parsed as JSON, text, form fields or base64 for binary, and your address.' },
      { method: 'ANY', path: '/v1/utils/anything/{whatever}', doc: 'The same as /echo under any path you like.' },
      { method: 'GET', path: '/v1/utils/get', doc: 'Echo, but only GET is allowed; other methods answer 405 with an Allow header.' },
      { method: 'POST', path: '/v1/utils/post', doc: 'Echo for POST only. Likewise /put, /patch, /delete.' },
      { method: 'GET', path: '/v1/utils/headers', doc: 'Just the request headers.' },
      { method: 'GET', path: '/v1/utils/ip', doc: 'The address the request came from.' },
      { method: 'GET', path: '/v1/utils/user-agent', doc: 'Just the User-Agent.' },
      { method: 'GET', path: '/v1/utils/time', doc: 'The server clock in ISO, Unix seconds and milliseconds, RFC 2822.' },
      { method: 'GET', path: '/v1/utils/uuid', doc: 'A fresh UUID v4.' },
    ],
  },
  {
    name: 'Status codes and timing',
    slug: 'status',
    doc: 'Make the server answer the way you need to test the client.',
    entries: [
      { method: 'ANY', path: '/v1/utils/status/{code}', doc: 'Any status 100–599. A comma list picks one at random per request (/status/200,500,503). 3xx carry a Location, 401 a WWW-Authenticate, 429 and 503 a Retry-After.' },
      { method: 'GET', path: '/v1/utils/delay/{seconds}', doc: 'Waits that long (decimals allowed, 10 s at most) before answering.' },
    ],
  },
  {
    name: 'Redirects',
    slug: 'redirects',
    doc: 'Chains and single hops, relative and absolute.',
    entries: [
      { method: 'GET', path: '/v1/utils/redirect/{n}', doc: 'n redirects (302, absolute Location) ending at /get.' },
      { method: 'GET', path: '/v1/utils/relative-redirect/{n}', doc: 'The same with a relative Location.' },
      { method: 'GET', path: '/v1/utils/absolute-redirect/{n}', doc: 'The same with an absolute Location.' },
      { method: 'GET', path: '/v1/utils/redirect-to?url=/v1/utils/get&status=307', doc: 'One redirect to a path on this host with the status you choose (301, 302, 303, 307, 308). Never to another host.' },
    ],
  },
  {
    name: 'Cookies',
    slug: 'cookies',
    doc: 'Set, read and delete; a cookie jar has something to hold.',
    entries: [
      { method: 'GET', path: '/v1/utils/cookies', doc: 'The cookies the request carried.' },
      { method: 'GET', path: '/v1/utils/cookies/set?name=value', doc: 'Sets each query parameter as a cookie (Path=/, a day) and redirects to /cookies.' },
      { method: 'GET', path: '/v1/utils/cookies/set/{name}/{value}', doc: 'Sets one cookie from the path.' },
      { method: 'GET', path: '/v1/utils/cookies/delete?name', doc: 'Expires the named cookies and redirects to /cookies.' },
    ],
  },
  {
    name: 'Bodies, encodings, streams',
    slug: 'bodies',
    doc: 'Every shape a response can take.',
    entries: [
      { method: 'GET', path: '/v1/utils/json', doc: 'A sample JSON document with nesting, numbers, unicode and null.' },
      { method: 'GET', path: '/v1/utils/xml', doc: 'A sample XML document.' },
      { method: 'GET', path: '/v1/utils/html', doc: 'A sample HTML page.' },
      { method: 'GET', path: '/v1/utils/encoding/utf8', doc: 'UTF-8 text from several scripts, with an emoji and a tab.' },
      { method: 'GET', path: '/v1/utils/gzip', doc: 'A JSON body compressed with gzip (Content-Encoding: gzip). /deflate likewise.' },
      { method: 'GET', path: '/v1/utils/bytes/{n}', doc: 'n random bytes (1 MB at most); ?seed=x makes them repeatable.' },
      { method: 'GET', path: '/v1/utils/range/{n}', doc: 'n bytes with Accept-Ranges; send Range: bytes=10-19 for a 206.' },
      { method: 'GET', path: '/v1/utils/big?rows=5000', doc: 'A large JSON array (up to 20,000 rows) to try a viewer on.' },
      { method: 'GET', path: '/v1/utils/stream/{n}?interval=100', doc: 'n lines of JSON (NDJSON), one every interval ms, chunked.' },
      { method: 'GET', path: '/v1/utils/stream-bytes/{n}?chunk=1024', doc: 'n random bytes in chunks.' },
      { method: 'GET', path: '/v1/utils/drip?numbytes=20&duration=3&delay=0&code=200', doc: 'Bytes dripped over the duration, after an optional delay.' },
      { method: 'GET', path: '/v1/utils/image/svg?text=hello&w=320&h=200&color=f1772c', doc: 'An SVG with your text. /image/png draws a real PNG (w, h, color); /image picks by your Accept header.' },
    ],
  },
  {
    name: 'Tools',
    slug: 'tools',
    doc: 'Small helpers that are handy mid-test.',
    entries: [
      { method: 'GET', path: '/v1/utils/base64/{value}', doc: 'Decodes base64 (standard or URL-safe) to text.' },
      { method: 'POST', path: '/v1/utils/base64', doc: 'Encodes the body you send, standard and URL-safe.' },
      { method: 'GET', path: '/v1/utils/hash/{algo}?text=sonda', doc: 'md5, sha1, sha256, sha384, sha512 or crc32 of ?text= — or POST the bytes.' },
      { method: 'GET', path: '/v1/utils/cache', doc: 'ETag and Last-Modified; If-None-Match or If-Modified-Since earns a 304.' },
      { method: 'GET', path: '/v1/utils/cache/{seconds}', doc: 'Cache-Control: max-age of your choosing.' },
      { method: 'GET', path: '/v1/utils/etag/{tag}', doc: 'Your own ETag; If-None-Match gives 304, a wrong If-Match gives 412.' },
      { method: 'GET', path: '/v1/utils/response-headers?X-Powered-By=sondahub', doc: 'Each query parameter comes back as a response header.' },
    ],
  },
  {
    name: 'Forms and uploads',
    slug: 'forms',
    doc: 'Multipart and urlencoded, parsed and described.',
    entries: [
      { method: 'POST', path: '/v1/utils/forms/post', doc: 'Fields and files, with each file’s size, type, SHA-256 and MD5 (1 MB in all). /upload is the same route.', hint: 'multipart/form-data or application/x-www-form-urlencoded' },
    ],
  },
  {
    name: 'Streams and sockets',
    slug: 'streams',
    doc: 'Server-Sent Events and WebSockets with nothing to set up.',
    entries: [
      { method: 'GET', path: '/v1/utils/sse?count=10&interval=1000', doc: 'A clock over SSE: count ticks, one per interval, with ids, a second event name every fifth tick, and Last-Event-ID resumption.' },
      { method: 'WS', path: '/v1/utils/ws', doc: 'Echo: every frame you send comes straight back, text or binary.' },
    ],
  },
  {
    name: 'Authentication',
    slug: 'auth',
    doc: `Basic, Digest, API key and Bearer, checked for real. User ${CREDS.username} / ${CREDS.password}; API key ${CREDS.apiKey}.`,
    entries: [
      { method: 'GET', path: '/v1/utils/auth/basic', doc: `HTTP Basic with ${CREDS.username} / ${CREDS.password}. /auth/basic/{user}/{pass} takes any pair you name. Wrong or missing answers 401 with WWW-Authenticate.` },
      { method: 'GET', path: '/v1/utils/auth/hidden-basic/{user}/{pass}', doc: 'Basic, but a failure answers 404 as if the route did not exist.' },
      { method: 'GET', path: '/v1/utils/auth/bearer', doc: 'Any non-empty bearer token passes. /auth/bearer/{token} wants exactly that token.' },
      { method: 'GET', path: '/v1/utils/auth/apikey', doc: `X-API-Key: ${CREDS.apiKey} (or ?api_key=, or Authorization: ApiKey …). /auth/apikey/{key} wants that key instead.` },
      { method: 'GET', path: '/v1/utils/auth/digest', doc: `HTTP Digest (RFC 7616) with ${CREDS.username} / ${CREDS.password}: ?algorithm=MD5|MD5-sess|SHA-256|SHA-256-sess and ?qop=auth|auth-int choose the challenge; /auth/digest/{user}/{pass} takes any pair. A failed check says which part did not match.` },
    ],
  },
]
