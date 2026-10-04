// Encoding and signing helpers over WebCrypto, plus an MD5 for HTTP Digest
// (WebCrypto has none and the RFC's default algorithm is MD5).

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function b64(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function b64Decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function hex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function buf(data: string | Uint8Array | ArrayBuffer): BufferSource {
  return (typeof data === 'string' ? enc.encode(data) : data) as BufferSource
}

export async function sha256(data: string | Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', buf(data))
}

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  return hex(await sha256(data))
}

export async function digestHex(algo: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512', data: string | Uint8Array | ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest(algo, buf(data)))
}

export async function hmac(key: string | Uint8Array | ArrayBuffer, data: string | Uint8Array, algo: 'SHA-256' | 'SHA-1' = 'SHA-256'): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', buf(key), { name: 'HMAC', hash: algo }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, buf(data))
}

export async function hmacHex(key: string | Uint8Array | ArrayBuffer, data: string | Uint8Array): Promise<string> {
  return hex(await hmac(key, data))
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return hex(b)
}

// ---- MD5 (RFC 1321) ----

const K = new Uint32Array(64)
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]

export function md5(input: string | Uint8Array): Uint8Array {
  const msg = typeof input === 'string' ? enc.encode(input) : input
  const len = msg.length
  const withPad = ((len + 8) >> 6) + 1
  const bytes = new Uint8Array(withPad * 64)
  bytes.set(msg)
  bytes[len] = 0x80
  const bits = len * 8
  const dv = new DataView(bytes.buffer)
  dv.setUint32(bytes.length - 8, bits >>> 0, true)
  dv.setUint32(bytes.length - 4, Math.floor(bits / 4294967296), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, a0, true)
  odv.setUint32(4, b0, true)
  odv.setUint32(8, c0, true)
  odv.setUint32(12, d0, true)
  return out
}

export function md5Hex(input: string | Uint8Array): string {
  return hex(md5(input))
}

// ---- CRC32, for the PNG the image endpoint draws ----

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
