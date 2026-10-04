// The HTTP server: Node's own, no framework. Each request becomes a fetch
// Request for handle() (src/router.ts), and the Response goes back out,
// streamed. WebSockets are bridged here with a small frame codec: the
// handler holds one end of a SocketPair (src/ws.ts), this file the other.

import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { AddressInfo, Socket } from 'node:net'
import { handle } from './router'
import { HubSocket, upgradeOf } from './ws'
import { warm } from './data/db'

export interface Options {
  port?: number
  host?: string
  /** Log one line per request. */
  log?: boolean
}

export interface Running {
  server: Server
  url: string
  close(): Promise<void>
}

const MAX_FRAME = 4_000_000

function toRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) headers.append(k, x)
    else headers.set(k, v)
  }
  if (!headers.has('X-Forwarded-For')) headers.set('X-Forwarded-For', req.socket.remoteAddress ?? '127.0.0.1')
  const method = req.method ?? 'GET'
  const init: RequestInit & { duplex?: string } = { method, headers }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    init.body = new ReadableStream({
      start(controller) {
        req.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        req.on('end', () => controller.close())
        req.on('error', (e) => controller.error(e))
      },
    })
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function answer(req: IncomingMessage, res: ServerResponse, log: boolean): Promise<void> {
  const t0 = Date.now()
  try {
    const r = await handle(toRequest(req))
    const headers: Record<string, string | string[]> = {}
    r.headers.forEach((v, k) => {
      if (k === 'set-cookie') {
        const prev = headers[k]
        headers[k] = prev ? [...(Array.isArray(prev) ? prev : [prev]), v] : [v]
      } else headers[k] = v
    })
    res.writeHead(r.status, headers)
    if (req.method === 'HEAD' || !r.body) res.end()
    else {
      res.flushHeaders()
      const reader = r.body.getReader()
      res.on('close', () => reader.cancel().catch(() => undefined))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.write(value)) await new Promise((resolve) => res.once('drain', resolve))
      }
      res.end()
    }
    if (log) console.log(`${req.method} ${req.url} → ${r.status} ${Date.now() - t0}ms`)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('server error: ' + (e as Error).message)
  }
}

async function upgrade(req: IncomingMessage, socket: Socket, head: Buffer, log: boolean): Promise<void> {
  try {
    const key = req.headers['sec-websocket-key'] as string | undefined
    if (!key) {
      socket.destroy()
      return
    }
    const r = await handle(toRequest(req))
    const up = upgradeOf(r)
    if (!up) {
      const body = await r.text()
      socket.write(`HTTP/1.1 ${r.status} ${r.statusText || 'Bad Request'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
      socket.destroy()
      return
    }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`]
    const proto = up.headers.get('Sec-WebSocket-Protocol')
    if (proto) lines.push(`Sec-WebSocket-Protocol: ${proto}`)
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    bridge(socket, up.webSocket, head)
    if (log) console.log(`WS ${req.url} → open`)
  } catch (e) {
    console.error('upgrade', e)
    socket.destroy()
  }
}

function bridge(socket: Socket, client: HubSocket, head: Buffer): void {
  let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0)
  let fragments: Buffer[] = []
  let fragOpcode = 0
  let closedByPeer = false

  client.onOut = (data) => {
    if (typeof data === 'string') socket.write(frame(0x1, Buffer.from(data, 'utf8')))
    else socket.write(frame(0x2, Buffer.from(data)))
  }
  client.onClose = (code, reason) => {
    if (closedByPeer) return
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason))
    payload.writeUInt16BE(code || 1000, 0)
    payload.write(reason, 2)
    try {
      socket.write(frame(0x8, payload))
    } catch {
      /* gone */
    }
    setTimeout(() => socket.destroy(), 100)
  }
  client.accept() // the network side is wired: anything the handler sent already flows out

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const fin = (buf[0] & 0x80) !== 0
      const opcode = buf[0] & 0x0f
      const masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      if (len > MAX_FRAME) {
        client.close(1009, 'too big')
        socket.destroy()
        return
      }
      let mask: Buffer | null = null
      if (masked) {
        if (buf.length < off + 4) return
        mask = buf.subarray(off, off + 4)
        off += 4
      }
      if (buf.length < off + len) return
      const payload = Buffer.from(buf.subarray(off, off + len))
      buf = buf.subarray(off + len)
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]

      if (opcode === 0x8) {
        closedByPeer = true
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        try {
          socket.write(frame(0x8, payload.subarray(0, 2)))
        } catch {
          /* gone */
        }
        client.close(code, reason)
        setTimeout(() => socket.destroy(), 50)
        return
      }
      if (opcode === 0x9) {
        socket.write(frame(0xa, payload))
        continue
      }
      if (opcode === 0xa) continue
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        if (opcode !== 0x0) fragOpcode = opcode
        fragments.push(payload)
        if (fragments.reduce((s, f) => s + f.length, 0) > MAX_FRAME) {
          client.close(1009, 'too big')
          socket.destroy()
          return
        }
        if (!fin) continue
        const whole = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments)
        fragments = []
        if (fragOpcode === 0x1) client.send(whole.toString('utf8'))
        else client.send(whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength) as ArrayBuffer)
      }
    }
  })
  socket.on('close', () => {
    if (!client.closed) client.close(1006, 'socket closed')
  })
  socket.on('error', () => {
    if (!client.closed) client.close(1006, 'socket error')
  })
}

function frame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length])
  else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, payload])
}

/** Generates the seed, then listens. Port 0 picks a free port; the answer says which. */
export function startServer(opts: Options = {}): Promise<Running> {
  warm()
  const log = opts.log ?? false
  const server = createServer((req, res) => void answer(req, res, log))
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => void upgrade(req, socket, head, log))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', () => {
      const a = server.address() as AddressInfo
      const host = a.family === 'IPv6' ? `[${a.address}]` : a.address
      resolve({
        server,
        url: `http://${host === '0.0.0.0' || host === '[::]' ? 'localhost' : host}:${a.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
