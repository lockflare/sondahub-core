// Starts the server.
//
//   PORT        the port to listen on (8787)
//   HOST        the address to listen on (127.0.0.1; 0.0.0.0 for every interface, as in a container)
//   PUBLIC_URL  the address links in answers are built on, when the server sits behind a proxy
//   QUIET=1     no line per request

import { startServer } from './server'
import { config } from './env'
import { APP_VERSION } from './version'

config.publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '')
const port = parseInt(process.env.PORT ?? '8787', 10)
const host = process.env.HOST ?? '127.0.0.1'

try {
  const running = await startServer({ port, host, log: process.env.QUIET !== '1' })
  console.log(`sondahub-core ${APP_VERSION} on ${running.url} — GET /v1 lists everything`)
  const stop = () => running.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
} catch (e) {
  console.error(`Could not listen on ${host}:${port}: ${(e as Error).message}`)
  process.exit(1)
}
