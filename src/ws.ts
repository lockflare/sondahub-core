// WebSockets without a library. A handler gets a SocketPair: it keeps one
// end (accept, send, close, listen) and hands the other back in a 101
// answer; src/server.ts bridges that end to the network with a small frame
// codec. The handlers never touch a TCP socket.

type Listener = (ev: any) => void

export interface MessageEvent {
  data: string | ArrayBuffer
}

export class HubSocket {
  peer!: HubSocket
  readyState = 0
  closed = false
  private listeners: Record<string, Listener[]> = {}
  private queue: unknown[] = []
  private accepted = false
  /** Set by the server on the network end: outbound frames go here. */
  onOut: ((data: string | ArrayBuffer) => void) | null = null
  onClose: ((code: number, reason: string) => void) | null = null

  accept(): void {
    this.accepted = true
    this.readyState = 1
    const q = this.queue
    this.queue = []
    for (const m of q) this.deliver(m)
  }

  /** Called by the peer's send(): something arrived for this end. */
  receive(data: unknown): void {
    if (this.closed) return
    if (!this.accepted) {
      this.queue.push(data)
      return
    }
    this.deliver(data)
  }

  private deliver(data: unknown): void {
    if (this.onOut) {
      this.onOut(data as string | ArrayBuffer)
      return
    }
    for (const l of this.listeners.message ?? []) l({ data })
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.closed) return
    let payload: string | ArrayBuffer
    if (typeof data === 'string') payload = data
    else if (ArrayBuffer.isView(data)) payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    else payload = data
    this.peer.receive(payload)
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.peer.receiveClose(code, reason)
  }

  receiveClose(code: number, reason: string): void {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    if (this.onClose) this.onClose(code, reason)
    for (const l of this.listeners.close ?? []) l({ code, reason, wasClean: true })
  }

  addEventListener(type: 'message', l: (ev: MessageEvent) => void): void
  addEventListener(type: 'close' | 'error', l: (ev: any) => void): void
  addEventListener(type: string, l: Listener): void {
    ;(this.listeners[type] = this.listeners[type] ?? []).push(l)
  }
}

export class SocketPair {
  0: HubSocket
  1: HubSocket
  constructor() {
    const a = new HubSocket()
    const b = new HubSocket()
    a.peer = b
    b.peer = a
    this[0] = a
    this[1] = b
  }
}

/** What a handler returns to open a socket: a Response cannot carry status 101 in Node, so this shape stands in for one and the server knows it. */
export interface UpgradeAnswer {
  status: 101
  webSocket: HubSocket
  headers: Headers
}

export function upgradeResponse(client: HubSocket, headers?: Record<string, string>): Response {
  const answer: UpgradeAnswer = { status: 101, webSocket: client, headers: new Headers(headers ?? {}) }
  return answer as unknown as Response
}

export function upgradeOf(res: Response): UpgradeAnswer | null {
  const r = res as unknown as Partial<UpgradeAnswer>
  return r.status === 101 && r.webSocket instanceof HubSocket ? (r as UpgradeAnswer) : null
}

export function isUpgrade(req: Request): boolean {
  return (req.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket'
}
