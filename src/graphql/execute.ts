// Executes a parsed document against a schema: field collection with
// fragments and @skip/@include, argument and variable coercion, parallel
// resolution for queries and serial for mutations, null propagation,
// errors with paths and locations.

import { Document, OperationNode, SelectionNode, FieldNode, ValueNode, TypeNode, Loc } from './parser'
import { Schema, GType, GField, GArg, TypeRef, GqlContext, ref, named } from './schema'
import { HubError } from '../http'

export interface GqlError {
  message: string
  locations?: Loc[]
  path?: (string | number)[]
  extensions?: Record<string, unknown>
}

export class GraphQLError extends Error {
  constructor(message: string, public loc?: Loc, public path?: (string | number)[], public extensions?: Record<string, unknown>) {
    super(message)
  }
}

class NullViolation extends Error {}

interface Exec {
  schema: Schema
  doc: Document
  vars: Record<string, unknown>
  ctx: GqlContext
  errors: GqlError[]
}

export async function execute(schema: Schema, doc: Document, variables: Record<string, unknown> | null, operationName: string | null, ctx: GqlContext): Promise<{ data?: unknown; errors?: GqlError[] }> {
  const errors: GqlError[] = []
  let op: OperationNode | undefined
  if (operationName) {
    op = doc.operations.find((o) => o.name === operationName)
    if (!op) return { errors: [{ message: `Unknown operation named "${operationName}".` }] }
  } else if (doc.operations.length === 1) op = doc.operations[0]
  else if (doc.operations.length === 0) return { errors: [{ message: 'The document has no operation.' }] }
  else return { errors: [{ message: 'The document has several operations; send operationName to pick one.' }] }

  if (op.operation === 'subscription') return { errors: [{ message: 'Subscriptions are not offered over HTTP. The live rooms are at /v1/{api}/ws (WebSocket) and /v1/{api}/events (SSE).' }] }

  const vars: Record<string, unknown> = {}
  const ex: Exec = { schema, doc, vars, ctx, errors }
  try {
    for (const v of op.variables) {
      const given = variables && Object.prototype.hasOwnProperty.call(variables, v.name) ? variables[v.name] : undefined
      const value = given === undefined && v.defaultValue ? valueFromAst(v.defaultValue, {}) : given
      vars[v.name] = coerceInput(ex, typeFromNode(v.type), value, [`$${v.name}`], true)
    }
  } catch (e) {
    return { errors: [toError(e, [])] }
  }

  const rootName = op.operation === 'mutation' ? schema.mutationType : schema.queryType
  const root = schema.types.get(rootName) as Extract<GType, { kind: 'OBJECT' }>
  let data: unknown
  try {
    data = await executeSelections(ex, root, op.selections, op.operation === 'query' ? schema : null, [], op.operation === 'mutation')
  } catch (e) {
    if (e instanceof NullViolation) data = null
    else return { data: null, errors: [...errors, toError(e, [])] }
  }
  return errors.length ? { data, errors } : { data }
}

// ---------- field collection ----------

interface Grouped {
  key: string
  nodes: FieldNode[]
}

function collectFields(ex: Exec, type: Extract<GType, { kind: 'OBJECT' }>, selections: SelectionNode[], out: Map<string, Grouped>, visited = new Set<string>()): void {
  for (const sel of selections) {
    if (skipped(ex, sel)) continue
    if (sel.kind === 'Field') {
      const key = sel.alias ?? sel.name
      const g = out.get(key)
      if (g) g.nodes.push(sel)
      else out.set(key, { key, nodes: [sel] })
    } else if (sel.kind === 'InlineFragment') {
      if (sel.typeCondition && sel.typeCondition !== type.name) continue
      collectFields(ex, type, sel.selections, out, visited)
    } else {
      if (visited.has(sel.name)) continue
      const frag = ex.doc.fragments[sel.name]
      if (!frag) throw new GraphQLError(`Unknown fragment "${sel.name}".`, sel.loc)
      if (frag.typeCondition !== type.name) continue
      visited.add(sel.name)
      collectFields(ex, type, frag.selections, out, visited)
      visited.delete(sel.name)
    }
  }
}

function skipped(ex: Exec, sel: SelectionNode): boolean {
  for (const d of sel.directives) {
    if (d.name !== 'skip' && d.name !== 'include') continue
    const arg = d.args.find((a) => a.name === 'if')
    const v = arg ? !!valueFromAst(arg.value, ex.vars) : false
    if (d.name === 'skip' && v) return true
    if (d.name === 'include' && !v) return true
  }
  return false
}

// ---------- execution ----------

async function executeSelections(ex: Exec, type: Extract<GType, { kind: 'OBJECT' }>, selections: SelectionNode[], parent: unknown, path: (string | number)[], serial: boolean): Promise<Record<string, unknown>> {
  const grouped = new Map<string, Grouped>()
  collectFields(ex, type, selections, grouped)
  const out: Record<string, unknown> = {}
  if (serial) {
    for (const g of grouped.values()) out[g.key] = await executeField(ex, type, g, parent, [...path, g.key])
  } else {
    const entries = [...grouped.values()]
    const values = await Promise.all(entries.map((g) => executeField(ex, type, g, parent, [...path, g.key])))
    entries.forEach((g, i) => (out[g.key] = values[i]))
  }
  return out
}

async function executeField(ex: Exec, type: Extract<GType, { kind: 'OBJECT' }>, g: Grouped, parent: unknown, path: (string | number)[]): Promise<unknown> {
  const node = g.nodes[0]
  const name = node.name
  let def: GField | undefined
  let value: unknown
  let fieldType: TypeRef
  try {
    if (name === '__typename') return type.name
    if (type.name === ex.schema.queryType && name === '__schema') {
      def = { name, type: { kind: 'NonNull', of: named('__Schema') }, args: [] }
      value = ex.schema
    } else if (type.name === ex.schema.queryType && name === '__type') {
      def = { name, type: named('__Type'), args: [{ name: 'name', type: { kind: 'NonNull', of: named('String') } }] }
      const args = coerceArgs(ex, def, node, path)
      const t = ex.schema.types.get(String(args.name))
      value = t ? ref(named(t.name), ex.schema) : null
    } else {
      def = type.fields.find((f) => f.name === name)
      if (!def) {
        const names = type.fields.map((f) => f.name)
        const near = names.filter((n) => n.toLowerCase().includes(name.toLowerCase().slice(0, 4))).slice(0, 5)
        throw new GraphQLError(`Cannot query field "${name}" on type "${type.name}".${near.length ? ` Did you mean ${near.join(', ')}?` : ''} Fields: ${names.join(', ')}.`, node.loc, path)
      }
      const args = coerceArgs(ex, def, node, path)
      const resolver = def.resolve
      if (resolver) value = await resolver(parent, args, ex.ctx, { fieldName: name, parentType: type.name })
      else value = parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[name] : undefined
    }
    fieldType = def.type
  } catch (e) {
    if (e instanceof NullViolation) throw e
    ex.errors.push(toError(e, path, node.loc))
    if (def && def.type.kind === 'NonNull') throw new NullViolation()
    return null
  }
  try {
    return await completeValue(ex, fieldType, value, g.nodes, path)
  } catch (e) {
    if (e instanceof NullViolation) {
      if (fieldType.kind === 'NonNull') throw e
      return null
    }
    ex.errors.push(toError(e, path, node.loc))
    if (fieldType.kind === 'NonNull') throw new NullViolation()
    return null
  }
}

async function completeValue(ex: Exec, t: TypeRef, value: unknown, nodes: FieldNode[], path: (string | number)[]): Promise<unknown> {
  if (t.kind === 'NonNull') {
    const inner = await completeValue(ex, t.of, value, nodes, path)
    if (inner === null || inner === undefined) {
      ex.errors.push({ message: `Cannot return null for non-nullable field ${path.join('.')}.`, path: [...path], locations: [nodes[0].loc] })
      throw new NullViolation()
    }
    return inner
  }
  if (value === null || value === undefined) return null
  if (t.kind === 'List') {
    if (!Array.isArray(value)) throw new GraphQLError(`Expected a list at ${path.join('.')}.`, nodes[0].loc, path)
    const items = await Promise.all(
      value.map(async (item, i) => {
        try {
          return await completeValue(ex, t.of, item, nodes, [...path, i])
        } catch (e) {
          if (e instanceof NullViolation) {
            if (t.of.kind === 'NonNull') throw e
            return null
          }
          ex.errors.push(toError(e, [...path, i], nodes[0].loc))
          if (t.of.kind === 'NonNull') throw new NullViolation()
          return null
        }
      }),
    )
    return items
  }
  const def = ex.schema.types.get(t.name)
  if (!def) throw new GraphQLError(`Unknown type "${t.name}".`, nodes[0].loc, path)
  switch (def.kind) {
    case 'SCALAR':
      return serializeScalar(def.name, value)
    case 'ENUM':
      return String(value)
    case 'INPUT_OBJECT':
      throw new GraphQLError(`Input type "${def.name}" cannot be returned.`, nodes[0].loc, path)
    case 'OBJECT': {
      const selections = nodes.flatMap((n) => n.selections ?? [])
      if (!selections.length) throw new GraphQLError(`Field "${path[path.length - 1]}" of type "${def.name}" must have a selection of subfields. Try "${path[path.length - 1]} { ${def.fields.slice(0, 3).map((f) => f.name).join(' ')} }".`, nodes[0].loc, path)
      return executeSelections(ex, def, selections, value, path, false)
    }
  }
}

function serializeScalar(name: string, v: unknown): unknown {
  switch (name) {
    case 'Int':
      return typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? parseInt(v, 10) : typeof v === 'boolean' ? (v ? 1 : 0) : null
    case 'Float':
      return typeof v === 'number' ? v : typeof v === 'string' && !Number.isNaN(Number(v)) ? Number(v) : null
    case 'Boolean':
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : null
    case 'String':
    case 'ID':
    case 'Date':
    case 'DateTime':
      return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
    default:
      return v
  }
}

// ---------- arguments and input coercion ----------

function coerceArgs(ex: Exec, def: GField, node: FieldNode, path: (string | number)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const given of node.args) {
    if (!def.args.some((a) => a.name === given.name)) throw new GraphQLError(`Unknown argument "${given.name}" on field "${def.name}". Arguments: ${def.args.map((a) => a.name).join(', ') || 'none'}.`, node.loc, path)
  }
  for (const a of def.args) {
    const given = node.args.find((g) => g.name === a.name)
    let value: unknown
    if (given) {
      if (given.value.kind === 'Variable' && !(given.value.name in ex.vars)) throw new GraphQLError(`Variable "$${given.value.name}" is not defined by the operation.`, node.loc, path)
      value = valueFromAst(given.value, ex.vars)
    }
    if (value === undefined) value = a.defaultValue
    out[a.name] = coerceInput(ex, a.type, value, [...path, a.name], false, node.loc)
  }
  return out
}

function coerceInput(ex: Exec, t: TypeRef, value: unknown, path: (string | number)[], isVariable: boolean, loc?: Loc): unknown {
  const where = isVariable ? `Variable ${path[0]}` : `Argument "${path[path.length - 1]}"`
  if (t.kind === 'NonNull') {
    if (value === null || value === undefined) throw new GraphQLError(`${where} of required type ${typeString(t)} was not provided.`, loc, isVariable ? undefined : path)
    return coerceInput(ex, t.of, value, path, isVariable, loc)
  }
  if (value === null || value === undefined) return value
  if (t.kind === 'List') {
    const arr = Array.isArray(value) ? value : [value]
    return arr.map((v, i) => coerceInput(ex, t.of, v, [...path, i], isVariable, loc))
  }
  const def = ex.schema.types.get(t.name)
  if (!def) throw new GraphQLError(`Unknown input type "${t.name}".`, loc, path)
  const bad = (expected: string) => new GraphQLError(`${where} expected ${expected}, got ${JSON.stringify(value)}.`, loc, isVariable ? undefined : path)
  switch (def.kind) {
    case 'SCALAR':
      switch (def.name) {
        case 'Int':
          if (typeof value === 'number' && Number.isInteger(value)) return value
          if (typeof value === 'string' && /^-?\d+$/.test(value)) return parseInt(value, 10)
          throw bad('an Int')
        case 'Float':
          if (typeof value === 'number' && Number.isFinite(value)) return value
          if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
          throw bad('a Float')
        case 'Boolean':
          if (typeof value === 'boolean') return value
          throw bad('a Boolean')
        case 'String':
        case 'ID':
        case 'Date':
        case 'DateTime':
          if (typeof value === 'string') return value
          if (typeof value === 'number' && def.name === 'ID') return String(value)
          throw bad(`a ${def.name}`)
        default:
          return value
      }
    case 'ENUM': {
      if (typeof value !== 'string' || !def.values.some((v) => v.name === value)) throw bad(`one of ${def.values.map((v) => v.name).join(', ')}`)
      return value
    }
    case 'INPUT_OBJECT': {
      if (typeof value !== 'object' || Array.isArray(value)) throw bad(`an object of type ${def.name}`)
      const obj = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(obj)) {
        if (!def.inputFields.some((f) => f.name === k)) throw new GraphQLError(`Field "${k}" is not defined by type ${def.name}. Fields: ${def.inputFields.map((f) => f.name).join(', ')}.`, loc, isVariable ? undefined : path)
      }
      for (const f of def.inputFields) {
        let v = obj[f.name]
        if (v === undefined) v = f.defaultValue
        if (v === undefined) {
          if (f.type.kind === 'NonNull') throw new GraphQLError(`Field "${f.name}" of required type ${typeString(f.type)} was not provided (in ${def.name}).`, loc, isVariable ? undefined : path)
          continue
        }
        out[f.name] = coerceInput(ex, f.type, v, [...path, f.name], isVariable, loc)
      }
      return out
    }
    default:
      throw bad('an input value')
  }
}

export function valueFromAst(v: ValueNode, vars: Record<string, unknown>): unknown {
  switch (v.kind) {
    case 'Variable':
      return vars[v.name]
    case 'Int':
      return parseInt(v.value, 10)
    case 'Float':
      return parseFloat(v.value)
    case 'String':
      return v.value
    case 'Boolean':
      return v.value
    case 'Null':
      return null
    case 'Enum':
      return v.value
    case 'List':
      return v.values.map((x) => valueFromAst(x, vars))
    case 'Object': {
      const out: Record<string, unknown> = {}
      for (const f of v.fields) {
        const val = valueFromAst(f.value, vars)
        if (val !== undefined) out[f.name] = val
      }
      return out
    }
  }
}

function typeFromNode(t: TypeNode): TypeRef {
  if (t.kind === 'Named') return named(t.name)
  if (t.kind === 'List') return { kind: 'List', of: typeFromNode(t.type) }
  return { kind: 'NonNull', of: typeFromNode(t.type) }
}

export function typeString(t: TypeRef): string {
  if (t.kind === 'Named') return t.name
  if (t.kind === 'List') return `[${typeString(t.of)}]`
  return `${typeString(t.of)}!`
}

function toError(e: unknown, path: (string | number)[], loc?: Loc): GqlError {
  if (e instanceof GraphQLError) {
    const out: GqlError = { message: e.message }
    const l = e.loc ?? loc
    if (l) out.locations = [l]
    const p = e.path ?? path
    if (p.length) out.path = p
    if (e.extensions) out.extensions = e.extensions
    return out
  }
  if (e instanceof HubError) {
    const out: GqlError = { message: e.message, extensions: { code: e.code, status: e.status } }
    if (e.details !== undefined) out.extensions!.details = e.details
    if (loc) out.locations = [loc]
    if (path.length) out.path = path
    return out
  }
  const out: GqlError = { message: e instanceof Error ? e.message : String(e) }
  if (loc) out.locations = [loc]
  if (path.length) out.path = path
  return out
}

export type { GArg }
