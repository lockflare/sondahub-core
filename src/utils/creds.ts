// The playground's credentials. They are public on purpose: nothing here
// protects anything, they exist so an API client can prove a flow works.
// Set SONDAHUB_USER, SONDAHUB_PASSWORD and SONDAHUB_API_KEY to use others.
// Do not reuse them anywhere real.

const env = (name: string, fallback: string) => (typeof process !== 'undefined' && process.env?.[name]) || fallback

export const CREDS = {
  /** HTTP Basic and Digest. */
  username: env('SONDAHUB_USER', 'sonda'),
  password: env('SONDAHUB_PASSWORD', 'probe'),
  /** X-API-Key (or ?api_key=). */
  apiKey: env('SONDAHUB_API_KEY', 'sonda-probe-key'),
}

/** Signs the Digest nonces this server hands out. Made fresh at every start, so it is never in the source. */
export const NONCE_KEY = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
