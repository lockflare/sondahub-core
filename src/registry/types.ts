// The registry is the one source of truth: every API, its collections, their
// fields and relations. The data, the REST routes, the validation, the
// OpenAPI documents and the GraphQL schema are all read from here, so nothing
// can describe an endpoint that does not exist.

export type FieldType =
  | 'int'
  | 'float'
  | 'string'
  | 'text'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'json'
  | 'ref'

export interface Field {
  name: string
  type: FieldType
  /** A sentence for the docs and the OpenAPI description. */
  doc?: string
  /** Required on POST and PUT. */
  required?: boolean
  /** Allowed values, for type 'enum'. */
  values?: string[]
  /** The collection an id points at, for type 'ref'. */
  ref?: string
  /** Set by the server; rejected on write (id, created_at, updated_at are readonly by default). */
  readonly?: boolean
  /** Part of ?q= full-text search (strings are, unless told otherwise). */
  search?: boolean
  /** Shape of a 'json' field, for the docs. */
  shape?: string
  /** Example value for the docs and OpenAPI. */
  example?: unknown
  /** Numeric bounds, checked on write. */
  min?: number
  max?: number
}

export interface Relation {
  /** The name the relation appears under in ?expand= and GraphQL. */
  name: string
  kind: 'belongsTo' | 'hasMany'
  /** The related collection (in the same API). */
  collection: string
  /** belongsTo: the local ref field. hasMany: the ref field on the other side. */
  field: string
}

export type Row = Record<string, unknown>

export interface Collection {
  /** Plural, the URL segment: products. */
  name: string
  /** Singular, for the docs and GraphQL type: product. */
  singular: string
  doc: string
  fields: Field[]
  relations?: Relation[]
  /** How many seed rows the generator makes. */
  count: number
  /** Default ordering for a list without ?sort=. */
  sort?: string
  /** Fields the docs show in the sample table (default: the first few). */
  preview?: string[]
}

export interface FeedDoc {
  topic: string
  doc: string
  every: string
}

export interface Api {
  /** URL segment: store. */
  name: string
  title: string
  tagline: string
  doc: string
  collections: Collection[]
  /** The live events the API's WebSocket / SSE stream publishes. */
  feeds: FeedDoc[]
}

export const SYSTEM_FIELDS: Field[] = [
  { name: 'id', type: 'int', readonly: true, doc: 'Assigned by the server. Seed records keep their ids across restarts; records you create continue after the seed.' },
  { name: 'created_at', type: 'datetime', readonly: true, doc: 'When the record was created (ISO 8601, UTC).' },
  { name: 'updated_at', type: 'datetime', readonly: true, doc: 'When the record last changed.' },
]

/** The columns of a collection's table, system ones first. */
export function allFields(c: Collection): Field[] {
  return [...SYSTEM_FIELDS, ...c.fields]
}

export function findCollection(api: Api, name: string): Collection | undefined {
  return api.collections.find((c) => c.name === name)
}
