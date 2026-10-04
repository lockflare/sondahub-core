import { Api, Collection, Field, allFields } from '../registry/types'
import { APP_VERSION } from '../version'
import { hooksFor } from './hooks'

type Schema = Record<string, unknown>

export function fieldSchema(f: Field): Schema {
  const s: Schema = {}
  switch (f.type) {
    case 'int':
    case 'ref':
      s.type = 'integer'
      break
    case 'float':
      s.type = 'number'
      break
    case 'bool':
      s.type = 'boolean'
      break
    case 'date':
      s.type = 'string'
      s.format = 'date'
      break
    case 'datetime':
      s.type = 'string'
      s.format = 'date-time'
      break
    case 'enum':
      s.type = 'string'
      s.enum = f.values
      break
    case 'json':
      if (f.shape && f.shape.endsWith('[]')) {
        s.type = 'array'
        s.items = f.shape.startsWith('string') ? { type: 'string' } : { type: 'object', additionalProperties: true }
      } else {
        s.type = 'object'
        s.additionalProperties = true
      }
      break
    default:
      s.type = 'string'
  }
  if (f.type !== 'json' && !f.required) s.nullable = true
  const doc = [f.doc, f.type === 'ref' ? `The id of a ${f.ref?.replace(/s$/, '')}.` : '', f.shape ? `Shape: ${f.shape}` : ''].filter(Boolean).join(' ')
  if (doc) s.description = doc
  if (f.example !== undefined) s.example = f.example
  else if (f.type === 'enum' && f.values) s.example = f.values[0]
  if (f.min !== undefined) s.minimum = f.min
  if (f.max !== undefined) s.maximum = f.max
  if (f.readonly) s.readOnly = true
  return s
}

export function exampleFor(f: Field): unknown {
  if (f.example !== undefined) return f.example
  switch (f.type) {
    case 'int':
      return 1
    case 'ref':
      return 1
    case 'float':
      return 9.99
    case 'bool':
      return true
    case 'date':
      return '2026-09-30'
    case 'datetime':
      return '2026-09-30T12:00:00Z'
    case 'enum':
      return f.values?.[0]
    case 'json':
      return f.shape && f.shape.endsWith('[]') ? [] : {}
    default:
      return `A ${f.name.replace(/_/g, ' ')}`
  }
}

function typeName(c: Collection): string {
  return c.singular
    .split('_')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('')
}

export function openApiFor(api: Api, base: string): Schema {
  const schemas: Record<string, Schema> = {
    Error: {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: { code: { type: 'string', example: 'validation_failed' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object', additionalProperties: true } } },
          required: ['code', 'message'],
        },
      },
    },
    ListMeta: {
      type: 'object',
      properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, pages: { type: 'integer' } },
    },
  }
  const paths: Record<string, Schema> = {}
  const tags: Schema[] = []

  for (const c of api.collections) {
    const T = typeName(c)
    const fields = allFields(c)
    const props: Record<string, Schema> = {}
    for (const f of fields) props[f.name] = fieldSchema(f)
    schemas[T] = { type: 'object', properties: props, required: fields.filter((f) => f.required || f.readonly).map((f) => f.name) }
    const inProps: Record<string, Schema> = {}
    const example: Record<string, unknown> = {}
    for (const f of c.fields) {
      if (f.readonly) continue
      inProps[f.name] = fieldSchema(f)
      if (f.required || f.type === 'enum' || f.example !== undefined) example[f.name] = exampleFor(f)
    }
    const hooks = hooksFor(api.name, c.name)
    for (const k of hooks.extraKeys ?? []) {
      if (k === 'items') {
        inProps.items = { type: 'array', description: 'Lines to add; the server prices them from the products and computes the totals.', items: { type: 'object', properties: { product_id: { type: 'integer' }, quantity: { type: 'integer', minimum: 1 } }, required: ['product_id'] } }
        example.items = [{ product_id: 1, quantity: 2 }]
      }
    }
    schemas[`${T}Input`] = { type: 'object', properties: inProps, required: c.fields.filter((f) => f.required && !f.readonly).map((f) => f.name), example }
    schemas[`${T}List`] = { type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${T}` } }, meta: { $ref: '#/components/schemas/ListMeta' } } }

    tags.push({ name: c.name, description: c.doc })

    const filterParams: Schema[] = fields
      .filter((f) => f.type !== 'json' && f.type !== 'text')
      .map((f) => ({
        name: f.name,
        in: 'query',
        required: false,
        description: `Filter: ${f.name} equals the value. Suffix the name with _ne, _gt, _gte, _lt, _lte, _like (contains, case-insensitive) or _in (comma list); "null" matches missing values.`,
        schema: fieldSchema(f),
      }))
    const commonList: Schema[] = [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
      { name: 'sort', in: 'query', description: `Comma-separated fields; prefix with - for descending. Default: ${c.sort ?? 'id'}.`, schema: { type: 'string', example: c.sort ?? '-id' } },
      { name: 'q', in: 'query', description: 'Full-text search over the string fields.', schema: { type: 'string' } },
      { name: 'fields', in: 'query', description: 'Comma-separated fields to return.', schema: { type: 'string' } },
      ...(c.relations?.length ? [{ name: 'expand', in: 'query', description: `Comma-separated relations to embed: ${c.relations.map((r) => r.name).join(', ')}.`, schema: { type: 'string' } }] : []),
    ]
    const idParam: Schema = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
    const errors = {
      '400': { description: 'A parameter could not be read.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '404': { description: 'No such record.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '422': { description: 'The body failed validation; details lists each field.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    }

    paths[`/v1/${api.name}/${c.name}`] = {
      get: {
        tags: [c.name],
        summary: `List ${c.name}`,
        operationId: `list_${c.name}`,
        parameters: [...commonList, ...filterParams],
        responses: { '200': { description: 'A page.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}List` } } } }, '400': errors['400'] },
      },
      post: {
        tags: [c.name],
        summary: `Create a ${c.singular.replace(/_/g, ' ')}`,
        operationId: `create_${c.singular}`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}Input` } } } },
        responses: { '201': { description: 'Created: the record, with its id. The Location header points at it.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}` } } } }, '422': errors['422'] },
      },
    }
    paths[`/v1/${api.name}/${c.name}/{id}`] = {
      get: {
        tags: [c.name],
        summary: `Get a ${c.singular.replace(/_/g, ' ')}`,
        operationId: `get_${c.singular}`,
        parameters: [idParam, ...(c.relations?.length ? [{ name: 'expand', in: 'query', schema: { type: 'string' } }] : [])],
        responses: { '200': { description: 'The record.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}` } } } }, '304': { description: 'Unchanged since the ETag you sent.' }, '404': errors['404'] },
      },
      put: {
        tags: [c.name],
        summary: `Replace a ${c.singular.replace(/_/g, ' ')}`,
        operationId: `replace_${c.singular}`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}Input` } } } },
        responses: { '200': { description: 'The record as saved.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}` } } } }, '404': errors['404'], '422': errors['422'] },
      },
      patch: {
        tags: [c.name],
        summary: `Update part of a ${c.singular.replace(/_/g, ' ')}`,
        operationId: `update_${c.singular}`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}Input` } } } },
        responses: { '200': { description: 'The record as saved.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${T}` } } } }, '404': errors['404'], '422': errors['422'] },
      },
      delete: {
        tags: [c.name],
        summary: `Delete a ${c.singular.replace(/_/g, ' ')}`,
        description: 'Answers 200 with the record that was removed.',
        operationId: `delete_${c.singular}`,
        parameters: [idParam],
        responses: { '200': { description: 'What was deleted.', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean' }, id: { type: 'integer' }, [c.singular]: { $ref: `#/components/schemas/${T}` } } } } } }, '404': errors['404'] },
      },
    }
    for (const rel of c.relations ?? []) {
      const target = api.collections.find((x) => x.name === rel.collection)
      if (!target) continue
      const RT = typeName(target)
      paths[`/v1/${api.name}/${c.name}/{id}/${rel.name}`] = {
        get: {
          tags: [c.name],
          summary: rel.kind === 'belongsTo' ? `The ${rel.name} of a ${c.singular.replace(/_/g, ' ')}` : `The ${rel.name} of a ${c.singular.replace(/_/g, ' ')}`,
          operationId: `${c.singular}_${rel.name}`,
          parameters: rel.kind === 'belongsTo' ? [idParam] : [idParam, ...commonList.filter((p) => p.name !== 'expand')],
          responses: {
            '200': { description: rel.kind === 'belongsTo' ? 'The related record.' : 'A page of related records.', content: { 'application/json': { schema: rel.kind === 'belongsTo' ? { $ref: `#/components/schemas/${RT}` } : { $ref: `#/components/schemas/${RT}List` } } } },
            '404': errors['404'],
          },
        },
      }
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: `sondahub-core ${api.title} API`,
      version: APP_VERSION,
      description: `${api.tagline}\n\n${api.doc}\n\nNo keys, no accounts. Writes (POST, PUT, PATCH, DELETE) are validated, run through the rules and kept in memory until the server stops or POST /v1/reset puts the seed back. Every list takes page, limit, sort, q, fields and expand, plus one filter per field with the operators _ne _gt _gte _lt _lte _like _in.`,
      contact: { name: 'sondahub-core', url: base },
    },
    servers: [{ url: base }],
    tags,
    paths,
    components: { schemas },
  }
}
