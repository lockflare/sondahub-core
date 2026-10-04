import { Rng, iso } from './prng'
import { CITIES, City, COMPANY_A, COMPANY_B, COMPANY_SUFFIX, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, STREETS, STREET_SUFFIXES } from './words'

export interface Person {
  first: string
  last: string
  name: string
  email: string
  phone: string
  username: string
}

const used = new Set<string>()

/** A person whose email is unique within a generation run (call resetUnique() per run). */
export function person(r: Rng): Person {
  const first = r.pick(FIRST_NAMES)
  const last = r.pick(LAST_NAMES)
  let base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '')
  let email = `${base}@${r.pick(EMAIL_DOMAINS)}`
  let n = 1
  while (used.has(email)) {
    n++
    email = `${base}${n}@${r.pick(EMAIL_DOMAINS)}`
  }
  used.add(email)
  const username = n === 1 ? base.replace('.', '_') : `${base.replace('.', '_')}${n}`
  return { first, last, name: `${first} ${last}`, email, phone: phone(r), username }
}

export function resetUnique(): void {
  used.clear()
}

export function phone(r: Rng): string {
  return `+1-${r.int(201, 989)}-${r.int(200, 999)}-${r.digits(4)}`
}

export interface Address {
  line1: string
  line2?: string
  city: string
  region: string
  postal_code: string
  country: string
}

export function address(r: Rng, c: City = r.pick(CITIES)): Address {
  const a: Address = {
    line1: `${r.int(1, 9800)} ${r.pick(STREETS)} ${r.pick(STREET_SUFFIXES)}`,
    city: c.city,
    region: c.region,
    postal_code: c.country === 'US' ? r.digits(5) : r.code(6, 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'),
    country: c.country,
  }
  if (r.chance(0.25)) a.line2 = r.chance(0.5) ? `Apt ${r.int(1, 40)}` : `Suite ${r.int(100, 900)}`
  return a
}

export function company(r: Rng): string {
  return `${r.pick(COMPANY_A)} ${r.pick(COMPANY_B)} ${r.pick(COMPANY_SUFFIX)}`
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function sentences(r: Rng, pool: readonly string[], n: number): string {
  return r.some(pool, n).join(' ')
}

export function money(v: number): number {
  return Math.round(v * 100) / 100
}

export function stamp(ms: number): string {
  return iso(ms)
}

/** A timestamp a little after another one (minutes). */
export function later(ms: number, r: Rng, minMinutes: number, maxMinutes: number): number {
  return ms + r.int(minMinutes, maxMinutes) * 60000
}
