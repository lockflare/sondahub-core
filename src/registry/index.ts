import { Api, Row, Collection, allFields } from './types'
import { storeApi, generateStore } from './store'
import { socialApi, generateSocial } from './social'
import { helpdeskApi, generateHelpdesk } from './helpdesk'

export const APIS: Api[] = [storeApi, socialApi, helpdeskApi]

export const GENERATORS: Record<string, () => Record<string, Row[]>> = {
  store: generateStore,
  social: generateSocial,
  helpdesk: generateHelpdesk,
}

export function findApi(name: string): Api | undefined {
  return APIS.find((a) => a.name === name)
}

/** A generated row in the shape the API answers: booleans real, json fields parsed. */
export function apiShape(c: Collection, raw: Row): Row {
  const out: Row = {}
  for (const f of allFields(c)) {
    let v = raw[f.name]
    if (v === undefined) v = null
    if (f.type === 'bool') v = v === null ? null : v === 1 || v === true || v === '1'
    else if (f.type === 'json' && typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        /* leave as is */
      }
    }
    out[f.name] = v
  }
  return out
}
