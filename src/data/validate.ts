import { Collection, Field, Row } from '../registry/types'
import { HubError } from '../http'
import { Ctx, exists, collectionOrThrow } from './db'
import { depthOf } from '../utils/json'

export type Mode = 'create' | 'replace' | 'patch'

export interface Problem {
  field: string
  message: string
}

/**
 * Check a body against the collection's fields. Returns the row to store:
 * on create/replace every writable field (missing optional ones as null),
 * on patch only the fields given. Throws 422 with one line per problem.
 */
export function validate(c: Collection, body: unknown, mode: Mode, allowExtra: string[] = []): Row {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HubError(422, 'validation_failed', 'The body must be a JSON object.', [{ field: '', message: 'expected an object' }])
  }
  const input = body as Row
  const problems: Problem[] = []
  const out: Row = {}
  const known = new Set(c.fields.map((f) => f.name))
  for (const k of Object.keys(input)) {
    if (known.has(k) || allowExtra.includes(k)) continue
    if (k === 'id' || k === 'created_at' || k === 'updated_at') problems.push({ field: k, message: 'is set by the server' })
    else problems.push({ field: k, message: `is not a field of ${c.name}` })
  }
  for (const f of c.fields) {
    const present = Object.prototype.hasOwnProperty.call(input, f.name)
    const v = input[f.name]
    if (f.readonly) {
      if (present && v !== null && v !== undefined) problems.push({ field: f.name, message: 'is read-only' })
      continue
    }
    if (!present || v === undefined) {
      if (mode !== 'patch') {
        if (f.required) problems.push({ field: f.name, message: 'is required' })
        else out[f.name] = null
      }
      continue
    }
    if (v === null) {
      if (f.required) problems.push({ field: f.name, message: 'is required' })
      else out[f.name] = null
      continue
    }
    const p = checkValue(f, v)
    if (p) problems.push({ field: f.name, message: p })
    else out[f.name] = normalize(f, v)
  }
  if (problems.length) {
    throw new HubError(422, 'validation_failed', problems.map((p) => (p.field ? `${p.field} ${p.message}` : p.message)).join('; ') + '.', problems)
  }
  return out
}

function checkValue(f: Field, v: unknown): string | null {
  switch (f.type) {
    case 'int':
    case 'ref':
      if (typeof v !== 'number' || !Number.isInteger(v)) return 'must be a whole number'
      if (!Number.isSafeInteger(v)) return 'must be between -9007199254740991 and 9007199254740991'
      break
    case 'float':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number'
      break
    case 'string':
      if (typeof v !== 'string') return 'must be a string'
      if (v.length > 500) return 'must be 500 characters or fewer'
      break
    case 'text':
      if (typeof v !== 'string') return 'must be a string'
      if (v.length > 10000) return 'must be 10,000 characters or fewer'
      break
    case 'bool':
      if (typeof v !== 'boolean') return 'must be true or false'
      break
    case 'date':
      if (typeof v !== 'string' || !isCalendarDate(v)) return 'must be a date like 2026-09-30'
      break
    case 'datetime':
      if (typeof v !== 'string' || !inYears(Date.parse(v))) return 'must be an ISO 8601 timestamp like 2026-09-30T12:00:00Z'
      break
    case 'enum':
      if (typeof v !== 'string' || !f.values?.includes(v)) return `must be one of ${f.values?.join(', ')}`
      break
    case 'json':
      if (typeof v !== 'object') return 'must be an object or an array'
      if (f.shape === 'string[]' && (!Array.isArray(v) || !v.every((x) => typeof x === 'string'))) return 'must be a list of strings'
      if (depthOf(v, MAX_JSON_DEPTH) > MAX_JSON_DEPTH) return `must nest no more than ${MAX_JSON_DEPTH} levels deep`
      if (JSON.stringify(v).length > 20000) return 'is too large (20,000 characters of JSON at most)'
      break
  }
  if (typeof v === 'number') {
    if (f.min !== undefined && v < f.min) return `must be at least ${f.min}`
    if (f.max !== undefined && v > f.max) return `must be at most ${f.max}`
  }
  return null
}

const MAX_JSON_DEPTH = 32

/** YYYY-MM-DD naming a day the calendar has (no 2026-02-31). */
function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (y < 1) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** A parsed timestamp in years 1 to 9999: what ISO 8601 and xs:dateTime both write plainly. */
function inYears(t: number): boolean {
  if (Number.isNaN(t)) return false
  const y = new Date(t).getUTCFullYear()
  return y >= 1 && y <= 9999
}

function normalize(f: Field, v: unknown): unknown {
  if (f.type === 'datetime' && typeof v === 'string') {
    const d = new Date(v)
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  return v
}

/** Every ref in the row must point at a record the caller can see. */
export async function checkRefs(ctx: Ctx, c: Collection, row: Row): Promise<void> {
  const problems: Problem[] = []
  for (const f of c.fields) {
    if (f.type !== 'ref' || !f.ref) continue
    const v = row[f.name]
    if (v === null || v === undefined) continue
    const target = collectionOrThrow(ctx.api, f.ref)
    if (!(await exists(ctx, target, v as number))) problems.push({ field: f.name, message: `points at ${target.singular} ${v}, which does not exist` })
  }
  if (problems.length) throw new HubError(422, 'validation_failed', problems.map((p) => `${p.field} ${p.message}`).join('; ') + '.', problems)
}
