// The GraphQL schema of one API, built from the registry: an object type
// per collection with its relations, filter/input types, a page type, and
// Query/Mutation roots with resolvers that call the same data layer REST
// uses. Introspection types live here too, as ordinary objects.

import { Api, Collection, Field, allFields, Row } from '../registry/types'
import { Ctx, list, getById, getMany, getChildren, collectionOrThrow, seedCount } from '../data/db'
import { parseQuery } from '../data/query'
import { createRecord, updateRecord, deleteRecord } from '../data/ops'
import { hooksFor } from '../rest/hooks'
import { APP_VERSION } from '../version'

export type TypeRef = { kind: 'Named'; name: string } | { kind: 'List'; of: TypeRef } | { kind: 'NonNull'; of: TypeRef }

export interface GArg {
  name: string
  description?: string
  type: TypeRef
  defaultValue?: unknown
}

export interface ResolveInfo {
  fieldName: string
  parentType: string
}

export type Resolver = (parent: any, args: Record<string, unknown>, ctx: GqlContext, info: ResolveInfo) => unknown

export interface GField {
  name: string
  description?: string
  type: TypeRef
  args: GArg[]
  resolve?: Resolver
  deprecationReason?: string
}

export type GType =
  | { kind: 'SCALAR'; name: string; description?: string }
  | { kind: 'OBJECT'; name: string; description?: string; fields: GField[] }
  | { kind: 'INPUT_OBJECT'; name: string; description?: string; inputFields: GArg[] }
  | { kind: 'ENUM'; name: string; description?: string; values: { name: string; description?: string }[] }

export interface Schema {
  types: Map<string, GType>
  queryType: string
  mutationType: string
}

export interface GqlContext {
  ctx: Ctx
  loader: Loader
}

const named = (name: string): TypeRef => ({ kind: 'Named', name })
const nonNull = (of: TypeRef): TypeRef => ({ kind: 'NonNull', of })
const listOf = (of: TypeRef): TypeRef => ({ kind: 'List', of })

function pascal(s: string): string {
  return s
    .split('_')
    .map((x) => (x ? x[0].toUpperCase() + x.slice(1) : ''))
    .join('')
}

export function typeNameOf(c: Collection): string {
  return pascal(c.singular)
}

function scalarFor(f: Field, api: Api, c: Collection): TypeRef {
  switch (f.type) {
    case 'int':
    case 'ref':
      return named('Int')
    case 'float':
      return named('Float')
    case 'bool':
      return named('Boolean')
    case 'date':
      return named('Date')
    case 'datetime':
      return named('DateTime')
    case 'json':
      return named('JSON')
    case 'enum':
      return named(`${typeNameOf(c)}${pascal(f.name)}`)
    default:
      return named('String')
  }
}

// ---------- the loader: one query per collection per tick, not one per row ----------

export class Loader {
  private byId = new Map<string, { ids: Set<number>; waiters: { id: number; resolve: (r: Row | null) => void }[] }>()
  private children = new Map<string, { parents: Set<number>; waiters: { id: number; resolve: (r: Row[]) => void }[] }>()
  private scheduled = false
  constructor(private ctx: Ctx) {}

  load(collection: string, id: number): Promise<Row | null> {
    let b = this.byId.get(collection)
    if (!b) this.byId.set(collection, (b = { ids: new Set(), waiters: [] }))
    b.ids.add(id)
    this.schedule()
    return new Promise((resolve) => b!.waiters.push({ id, resolve }))
  }

  loadChildren(collection: string, field: string, parentId: number): Promise<Row[]> {
    const key = `${collection}:${field}`
    let b = this.children.get(key)
    if (!b) this.children.set(key, (b = { parents: new Set(), waiters: [] }))
    b.parents.add(parentId)
    this.schedule()
    return new Promise((resolve) => b!.waiters.push({ id: parentId, resolve }))
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    Promise.resolve().then(() => setTimeout(() => this.flush(), 0))
  }

  private async flush(): Promise<void> {
    this.scheduled = false
    const byId = this.byId
    const children = this.children
    this.byId = new Map()
    this.children = new Map()
    for (const [collection, b] of byId) {
      const c = collectionOrThrow(this.ctx.api, collection)
      let found = new Map<number, Row>()
      try {
        found = await getMany(this.ctx, c, [...b.ids])
      } catch {
        /* answer nulls */
      }
      for (const w of b.waiters) w.resolve(found.get(w.id) ?? null)
    }
    for (const [key, b] of children) {
      const [collection, field] = key.split(':')
      const c = collectionOrThrow(this.ctx.api, collection)
      let rows: Row[] = []
      try {
        rows = await getChildren(this.ctx, c, field, [...b.parents])
      } catch {
        /* answer empties */
      }
      const grouped = new Map<number, Row[]>()
      for (const r of rows) {
        const k = r[field] as number
        const arr = grouped.get(k) ?? []
        if (arr.length < 100) arr.push(r)
        grouped.set(k, arr)
      }
      for (const w of b.waiters) w.resolve(grouped.get(w.id) ?? [])
    }
  }
}

// ---------- building ----------

const cache = new Map<string, Schema>()

export function schemaFor(api: Api): Schema {
  const hit = cache.get(api.name)
  if (hit) return hit
  const types = new Map<string, GType>()
  const add = (t: GType) => types.set(t.name, t)

  for (const [name, description] of [
    ['Int', 'A 32-bit integer.'],
    ['Float', 'A double-precision number.'],
    ['String', 'UTF-8 text.'],
    ['Boolean', 'true or false.'],
    ['ID', 'An identifier, serialized as a string.'],
    ['JSON', 'Any JSON value: an object, an array, a scalar. Passed through as is.'],
    ['DateTime', 'An ISO 8601 timestamp in UTC, like 2026-09-30T12:00:00Z.'],
    ['Date', 'A calendar date, like 2026-09-30.'],
  ] as const) {
    add({ kind: 'SCALAR', name, description })
  }

  const listArgs = (c: Collection): GArg[] => [
    { name: 'page', description: 'Page number, from 1.', type: named('Int'), defaultValue: 1 },
    { name: 'limit', description: 'Rows per page, 1–200.', type: named('Int'), defaultValue: 20 },
    { name: 'sort', description: `Comma-separated fields, prefix - for descending. Default ${c.sort ?? 'id'}.`, type: named('String') },
    { name: 'q', description: 'Full-text search over the string fields.', type: named('String') },
    { name: 'filter', description: 'Field conditions; every key is a field name with an optional operator suffix.', type: named(`${typeNameOf(c)}Filter`) },
    { name: 'ids', description: 'Only these ids.', type: listOf(nonNull(named('Int'))) },
  ]

  const queryFields: GField[] = [
    { name: 'version', description: 'The server version.', type: nonNull(named('String')), args: [], resolve: () => APP_VERSION },
    { name: 'writes', description: 'How many rows this request has written so far.', type: nonNull(named('Int')), args: [], resolve: (_p, _a, g) => g.ctx.overlay.writes },
  ]
  const mutationFields: GField[] = []

  for (const c of api.collections) {
    const T = typeNameOf(c)
    // enums
    for (const f of c.fields) {
      if (f.type === 'enum' && f.values) add({ kind: 'ENUM', name: `${T}${pascal(f.name)}`, description: f.doc ?? `${f.name} of a ${c.singular.replace(/_/g, ' ')}.`, values: f.values.map((v) => ({ name: v })) })
    }
    // object
    const fields: GField[] = allFields(c).map((f) => ({
      name: f.name,
      description: f.doc,
      type: f.name === 'id' || f.required ? nonNull(scalarFor(f, api, c)) : scalarFor(f, api, c),
      args: [],
    }))
    for (const rel of c.relations ?? []) {
      const target = api.collections.find((x) => x.name === rel.collection)
      if (!target) continue
      const RT = typeNameOf(target)
      if (rel.kind === 'belongsTo') {
        fields.push({
          name: rel.name,
          description: `The ${target.singular.replace(/_/g, ' ')} this ${c.singular.replace(/_/g, ' ')} points at through ${rel.field}.`,
          type: named(RT),
          args: [],
          resolve: (parent: Row, _args, g) => {
            const fk = parent[rel.field]
            return fk === null || fk === undefined ? null : g.loader.load(target.name, fk as number)
          },
        })
      } else {
        fields.push({
          name: rel.name,
          description: `The ${target.name.replace(/_/g, ' ')} whose ${rel.field} is this ${c.singular.replace(/_/g, ' ')}. Up to 100 without arguments; give any argument for a filtered, paged query.`,
          type: nonNull(listOf(nonNull(named(RT)))),
          args: listArgs(target),
          resolve: async (parent: Row, args, g) => {
            const hasArgs = Object.keys(args).some((k) => args[k] !== undefined && args[k] !== null && !(k === 'page' && args[k] === 1) && !(k === 'limit' && args[k] === 20))
            if (!hasArgs) return g.loader.loadChildren(target.name, rel.field, parent.id as number)
            const q = parseQuery(target, argsToParams(args))
            const field = allFields(target).find((x) => x.name === rel.field)!
            const res = await list(g.ctx, target, q, [{ field, op: 'eq', value: parent.id }])
            return res.rows
          },
        })
      }
    }
    add({ kind: 'OBJECT', name: T, description: c.doc, fields })

    // page
    add({
      kind: 'OBJECT',
      name: `${T}Page`,
      description: `A page of ${c.name.replace(/_/g, ' ')}.`,
      fields: [
        { name: 'data', type: nonNull(listOf(nonNull(named(T)))), args: [] },
        { name: 'total', description: 'Rows matching, across all pages.', type: nonNull(named('Int')), args: [] },
        { name: 'page', type: nonNull(named('Int')), args: [] },
        { name: 'pages', type: nonNull(named('Int')), args: [] },
        { name: 'limit', type: nonNull(named('Int')), args: [] },
      ],
    })

    // filter input
    const filterFields: GArg[] = []
    for (const f of allFields(c)) {
      if (f.type === 'text') {
        filterFields.push({ name: `${f.name}_like`, type: named('String'), description: 'Contains, case-insensitive.' })
        continue
      }
      if (f.type === 'json') {
        filterFields.push({ name: `${f.name}_like`, type: named('String'), description: 'The JSON text contains this.' })
        continue
      }
      const t = scalarFor(f, api, c)
      filterFields.push({ name: f.name, type: t, description: 'Equals.' })
      filterFields.push({ name: `${f.name}_ne`, type: t, description: 'Does not equal.' })
      filterFields.push({ name: `${f.name}_in`, type: listOf(nonNull(t)), description: 'Any of.' })
      if (['int', 'ref', 'float', 'date', 'datetime'].includes(f.type)) {
        for (const op of ['gt', 'gte', 'lt', 'lte']) filterFields.push({ name: `${f.name}_${op}`, type: t })
      }
      if (f.type === 'string' || f.type === 'enum') filterFields.push({ name: `${f.name}_like`, type: named('String'), description: 'Contains, case-insensitive.' })
      filterFields.push({ name: `${f.name}_null`, type: named('Boolean'), description: 'true: is null; false: is not null.' })
    }
    add({ kind: 'INPUT_OBJECT', name: `${T}Filter`, description: `Conditions on ${c.name.replace(/_/g, ' ')}; all of them must hold.`, inputFields: filterFields })

    // input types
    const inputFields: GArg[] = []
    const patchFields: GArg[] = []
    for (const f of c.fields) {
      if (f.readonly) continue
      const t = scalarFor(f, api, c)
      inputFields.push({ name: f.name, description: f.doc, type: f.required ? nonNull(t) : t })
      patchFields.push({ name: f.name, description: f.doc, type: t })
    }
    const hooks = hooksFor(api.name, c.name)
    for (const k of hooks.extraKeys ?? []) {
      if (k === 'items') {
        add({ kind: 'INPUT_OBJECT', name: `${T}LineInput`, description: 'A line to add; the server prices it from the product.', inputFields: [{ name: 'product_id', type: nonNull(named('Int')) }, { name: 'quantity', type: named('Int'), defaultValue: 1 }] })
        inputFields.push({ name: 'items', description: 'Lines to add; the server prices them and computes the totals.', type: listOf(nonNull(named(`${T}LineInput`))) })
      }
    }
    add({ kind: 'INPUT_OBJECT', name: `${T}Input`, description: `A new ${c.singular.replace(/_/g, ' ')}.`, inputFields })
    add({ kind: 'INPUT_OBJECT', name: `${T}Patch`, description: `Fields of a ${c.singular.replace(/_/g, ' ')} to change.`, inputFields: patchFields })

    // query fields
    queryFields.push({
      name: c.name,
      description: `${c.doc} (${seedCount(api, c)} seed rows.)`,
      type: nonNull(named(`${T}Page`)),
      args: listArgs(c),
      resolve: async (_p, args, g) => {
        const q = parseQuery(c, argsToParams(args))
        const res = await list(g.ctx, c, q)
        return { data: res.rows, total: res.total, page: q.page, pages: Math.max(1, Math.ceil(res.total / q.limit)), limit: q.limit }
      },
    })
    queryFields.push({
      name: c.singular,
      description: `One ${c.singular.replace(/_/g, ' ')} by id, or null.`,
      type: named(T),
      args: [{ name: 'id', type: nonNull(named('Int')) }],
      resolve: (_p, args, g) => getById(g.ctx, c, Number(args.id)),
    })

    // mutations
    const opArgs = (g: GqlContext) => ({ ctx: g.ctx, c })
    mutationFields.push({
      name: `create${T}`,
      description: `Create a ${c.singular.replace(/_/g, ' ')}.`,
      type: nonNull(named(T)),
      args: [{ name: 'input', type: nonNull(named(`${T}Input`)) }],
      resolve: (_p, args, g) => createRecord(opArgs(g), args.input),
    })
    mutationFields.push({
      name: `update${T}`,
      description: `Change some fields of a ${c.singular.replace(/_/g, ' ')} (PATCH).`,
      type: nonNull(named(T)),
      args: [{ name: 'id', type: nonNull(named('Int')) }, { name: 'input', type: nonNull(named(`${T}Patch`)) }],
      resolve: (_p, args, g) => updateRecord(opArgs(g), Number(args.id), args.input, 'patch'),
    })
    mutationFields.push({
      name: `replace${T}`,
      description: `Replace a ${c.singular.replace(/_/g, ' ')} whole (PUT).`,
      type: nonNull(named(T)),
      args: [{ name: 'id', type: nonNull(named('Int')) }, { name: 'input', type: nonNull(named(`${T}Input`)) }],
      resolve: (_p, args, g) => updateRecord(opArgs(g), Number(args.id), args.input, 'replace'),
    })
    mutationFields.push({
      name: `delete${T}`,
      description: `Delete a ${c.singular.replace(/_/g, ' ')}.`,
      type: nonNull(named('Boolean')),
      args: [{ name: 'id', type: nonNull(named('Int')) }],
      resolve: async (_p, args, g) => {
        await deleteRecord(opArgs(g), Number(args.id))
        return true
      },
    })
  }

  add({ kind: 'OBJECT', name: 'Query', description: `${api.title}: ${api.tagline}`, fields: queryFields })
  add({ kind: 'OBJECT', name: 'Mutation', description: 'Writes: validated, run through the rules and kept in memory, the same as REST.', fields: mutationFields })
  addIntrospection(types)

  const schema: Schema = { types, queryType: 'Query', mutationType: 'Mutation' }
  cache.set(api.name, schema)
  return schema
}

/** GraphQL list args → the query-string shape parseQuery reads. */
function argsToParams(args: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams()
  const put = (k: string, v: unknown) => {
    if (v === undefined) return
    if (v === null) {
      p.set(k, 'null')
      return
    }
    if (Array.isArray(v)) {
      p.set(k, v.map((x) => String(x)).join(','))
      return
    }
    p.set(k, String(v))
  }
  for (const k of ['page', 'limit', 'sort', 'q']) put(k, args[k])
  if (Array.isArray(args.ids)) put('id_in', args.ids)
  if (args.filter && typeof args.filter === 'object') for (const [k, v] of Object.entries(args.filter as Record<string, unknown>)) put(k, v)
  return p
}

// ---------- introspection types ----------

function addIntrospection(types: Map<string, GType>): void {
  const add = (t: GType) => types.set(t.name, t)
  add({ kind: 'ENUM', name: '__TypeKind', values: ['SCALAR', 'OBJECT', 'INTERFACE', 'UNION', 'ENUM', 'INPUT_OBJECT', 'LIST', 'NON_NULL'].map((name) => ({ name })) })
  add({ kind: 'ENUM', name: '__DirectiveLocation', values: ['QUERY', 'MUTATION', 'SUBSCRIPTION', 'FIELD', 'FRAGMENT_DEFINITION', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT', 'VARIABLE_DEFINITION', 'SCHEMA', 'SCALAR', 'OBJECT', 'FIELD_DEFINITION', 'ARGUMENT_DEFINITION', 'INTERFACE', 'UNION', 'ENUM', 'ENUM_VALUE', 'INPUT_OBJECT', 'INPUT_FIELD_DEFINITION'].map((name) => ({ name })) })
  add({
    kind: 'OBJECT',
    name: '__Schema',
    fields: [
      { name: 'description', type: named('String'), args: [], resolve: () => null },
      { name: 'types', type: nonNull(listOf(nonNull(named('__Type')))), args: [], resolve: (s: Schema) => [...s.types.values()].map((t) => ref(named(t.name), s)) },
      { name: 'queryType', type: nonNull(named('__Type')), args: [], resolve: (s: Schema) => ref(named(s.queryType), s) },
      { name: 'mutationType', type: named('__Type'), args: [], resolve: (s: Schema) => ref(named(s.mutationType), s) },
      { name: 'subscriptionType', type: named('__Type'), args: [], resolve: () => null },
      { name: 'directives', type: nonNull(listOf(nonNull(named('__Directive')))), args: [], resolve: () => DIRECTIVES },
    ],
  })
  add({
    kind: 'OBJECT',
    name: '__Type',
    fields: [
      { name: 'kind', type: nonNull(named('__TypeKind')), args: [], resolve: (t: TypeView) => t.kind },
      { name: 'name', type: named('String'), args: [], resolve: (t: TypeView) => t.name ?? null },
      { name: 'description', type: named('String'), args: [], resolve: (t: TypeView) => t.description ?? null },
      { name: 'specifiedByURL', type: named('String'), args: [], resolve: () => null },
      { name: 'fields', type: listOf(nonNull(named('__Field'))), args: [{ name: 'includeDeprecated', type: named('Boolean'), defaultValue: false }], resolve: (t: TypeView) => t.fields ?? null },
      { name: 'interfaces', type: listOf(nonNull(named('__Type'))), args: [], resolve: (t: TypeView) => (t.kind === 'OBJECT' ? [] : null) },
      { name: 'possibleTypes', type: listOf(nonNull(named('__Type'))), args: [], resolve: () => null },
      { name: 'enumValues', type: listOf(nonNull(named('__EnumValue'))), args: [{ name: 'includeDeprecated', type: named('Boolean'), defaultValue: false }], resolve: (t: TypeView) => t.enumValues ?? null },
      { name: 'inputFields', type: listOf(nonNull(named('__InputValue'))), args: [{ name: 'includeDeprecated', type: named('Boolean'), defaultValue: false }], resolve: (t: TypeView) => t.inputFields ?? null },
      { name: 'ofType', type: named('__Type'), args: [], resolve: (t: TypeView) => t.ofType ?? null },
      { name: 'isOneOf', type: named('Boolean'), args: [], resolve: () => null },
    ],
  })
  add({
    kind: 'OBJECT',
    name: '__Field',
    fields: [
      { name: 'name', type: nonNull(named('String')), args: [], resolve: (f: FieldView) => f.name },
      { name: 'description', type: named('String'), args: [], resolve: (f: FieldView) => f.description ?? null },
      { name: 'args', type: nonNull(listOf(nonNull(named('__InputValue')))), args: [{ name: 'includeDeprecated', type: named('Boolean'), defaultValue: false }], resolve: (f: FieldView) => f.args },
      { name: 'type', type: nonNull(named('__Type')), args: [], resolve: (f: FieldView) => f.type },
      { name: 'isDeprecated', type: nonNull(named('Boolean')), args: [], resolve: (f: FieldView) => !!f.deprecationReason },
      { name: 'deprecationReason', type: named('String'), args: [], resolve: (f: FieldView) => f.deprecationReason ?? null },
    ],
  })
  add({
    kind: 'OBJECT',
    name: '__InputValue',
    fields: [
      { name: 'name', type: nonNull(named('String')), args: [], resolve: (a: ArgView) => a.name },
      { name: 'description', type: named('String'), args: [], resolve: (a: ArgView) => a.description ?? null },
      { name: 'type', type: nonNull(named('__Type')), args: [], resolve: (a: ArgView) => a.type },
      { name: 'defaultValue', type: named('String'), args: [], resolve: (a: ArgView) => (a.defaultValue === undefined ? null : JSON.stringify(a.defaultValue)) },
      { name: 'isDeprecated', type: nonNull(named('Boolean')), args: [], resolve: () => false },
      { name: 'deprecationReason', type: named('String'), args: [], resolve: () => null },
    ],
  })
  add({
    kind: 'OBJECT',
    name: '__EnumValue',
    fields: [
      { name: 'name', type: nonNull(named('String')), args: [], resolve: (v: { name: string }) => v.name },
      { name: 'description', type: named('String'), args: [], resolve: (v: { description?: string }) => v.description ?? null },
      { name: 'isDeprecated', type: nonNull(named('Boolean')), args: [], resolve: () => false },
      { name: 'deprecationReason', type: named('String'), args: [], resolve: () => null },
    ],
  })
  add({
    kind: 'OBJECT',
    name: '__Directive',
    fields: [
      { name: 'name', type: nonNull(named('String')), args: [], resolve: (d: DirectiveView) => d.name },
      { name: 'description', type: named('String'), args: [], resolve: (d: DirectiveView) => d.description },
      { name: 'locations', type: nonNull(listOf(nonNull(named('__DirectiveLocation')))), args: [], resolve: (d: DirectiveView) => d.locations },
      { name: 'args', type: nonNull(listOf(nonNull(named('__InputValue')))), args: [{ name: 'includeDeprecated', type: named('Boolean'), defaultValue: false }], resolve: (d: DirectiveView) => d.args },
      { name: 'isRepeatable', type: nonNull(named('Boolean')), args: [], resolve: () => false },
    ],
  })
}

export interface TypeView {
  kind: string
  name?: string
  description?: string
  /** Lazy: a view expands its fields only when a query asks for them, so cycles between types cost nothing. */
  fields?: FieldView[] | null
  enumValues?: { name: string; description?: string }[] | null
  inputFields?: ArgView[] | null
  ofType?: TypeView | null
}
export interface FieldView {
  name: string
  description?: string
  args: ArgView[]
  type: TypeView
  deprecationReason?: string
}
export interface ArgView {
  name: string
  description?: string
  type: TypeView
  defaultValue?: unknown
}
interface DirectiveView {
  name: string
  description: string
  locations: string[]
  args: ArgView[]
}

/** A type reference as introspection shows it: LIST/NON_NULL wrappers with ofType, named types expanded lazily. */
export function ref(t: TypeRef, s: Schema): TypeView {
  if (t.kind === 'List') return { kind: 'LIST', ofType: ref(t.of, s) }
  if (t.kind === 'NonNull') return { kind: 'NON_NULL', ofType: ref(t.of, s) }
  const def = s.types.get(t.name)
  if (!def) return { kind: 'SCALAR', name: t.name }
  const view: TypeView = { kind: def.kind, name: def.name, description: def.description, ofType: null }
  Object.defineProperty(view, 'fields', {
    enumerable: true,
    get: () => (def.kind === 'OBJECT' ? def.fields.map((f) => ({ name: f.name, description: f.description, args: f.args.map((a) => argView(a, s)), type: ref(f.type, s), deprecationReason: f.deprecationReason })) : null),
  })
  Object.defineProperty(view, 'enumValues', { enumerable: true, get: () => (def.kind === 'ENUM' ? def.values : null) })
  Object.defineProperty(view, 'inputFields', { enumerable: true, get: () => (def.kind === 'INPUT_OBJECT' ? def.inputFields.map((a) => argView(a, s)) : null) })
  return view
}

function argView(a: GArg, s: Schema): ArgView {
  const v: ArgView = { name: a.name, description: a.description, defaultValue: a.defaultValue } as ArgView
  Object.defineProperty(v, 'type', { enumerable: true, get: () => ref(a.type, s) })
  return v
}

const DIRECTIVES: DirectiveView[] = [
  { name: 'include', description: 'Include this part of the query when the argument is true.', locations: ['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT'], args: [{ name: 'if', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'Boolean' } } }] },
  { name: 'skip', description: 'Skip this part of the query when the argument is true.', locations: ['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT'], args: [{ name: 'if', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'Boolean' } } }] },
  { name: 'deprecated', description: 'Marks a field or enum value as no longer supported.', locations: ['FIELD_DEFINITION', 'ARGUMENT_DEFINITION', 'INPUT_FIELD_DEFINITION', 'ENUM_VALUE'], args: [{ name: 'reason', type: { kind: 'SCALAR', name: 'String' }, defaultValue: 'No longer supported' }] },
]

export { named, nonNull, listOf }
