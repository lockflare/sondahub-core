// Prints a schema as SDL, for ?sdl and the docs.

import { Schema, GType, GArg, TypeRef } from './schema'
import { typeString } from './execute'

function desc(s: string | undefined, indent = ''): string {
  if (!s) return ''
  return `${indent}"""${s.replace(/"""/g, '\\"""')}"""\n`
}

function arg(a: GArg): string {
  return `${a.name}: ${typeString(a.type)}${a.defaultValue !== undefined ? ` = ${JSON.stringify(a.defaultValue)}` : ''}`
}

export function printSchema(s: Schema): string {
  const out: string[] = [`schema {\n  query: ${s.queryType}\n  mutation: ${s.mutationType}\n}\n`]
  for (const t of s.types.values()) {
    if (t.name.startsWith('__')) continue
    switch (t.kind) {
      case 'SCALAR':
        if (['Int', 'Float', 'String', 'Boolean', 'ID'].includes(t.name)) continue
        out.push(`${desc(t.description)}scalar ${t.name}\n`)
        break
      case 'ENUM':
        out.push(`${desc(t.description)}enum ${t.name} {\n${t.values.map((v) => `  ${v.name}`).join('\n')}\n}\n`)
        break
      case 'INPUT_OBJECT':
        out.push(`${desc(t.description)}input ${t.name} {\n${t.inputFields.map((f) => `${desc(f.description, '  ')}  ${arg(f)}`).join('\n')}\n}\n`)
        break
      case 'OBJECT':
        out.push(
          `${desc(t.description)}type ${t.name} {\n${t.fields
            .map((f) => `${desc(f.description, '  ')}  ${f.name}${f.args.length ? `(${f.args.map(arg).join(', ')})` : ''}: ${typeString(f.type)}`)
            .join('\n')}\n}\n`,
        )
        break
    }
  }
  return out.join('\n')
}

export type { GType, TypeRef }
