// A GraphQL document parser: operations, selections, fragments, variables,
// arguments, directives and every value kind. No dependencies.

export interface Loc {
  line: number
  col: number
}

export type ValueNode =
  | { kind: 'Variable'; name: string }
  | { kind: 'Int'; value: string }
  | { kind: 'Float'; value: string }
  | { kind: 'String'; value: string }
  | { kind: 'Boolean'; value: boolean }
  | { kind: 'Null' }
  | { kind: 'Enum'; value: string }
  | { kind: 'List'; values: ValueNode[] }
  | { kind: 'Object'; fields: { name: string; value: ValueNode }[] }

export type TypeNode = { kind: 'Named'; name: string } | { kind: 'List'; type: TypeNode } | { kind: 'NonNull'; type: TypeNode }

export interface Argument {
  name: string
  value: ValueNode
}

export interface Directive {
  name: string
  args: Argument[]
}

export interface FieldNode {
  kind: 'Field'
  alias?: string
  name: string
  args: Argument[]
  directives: Directive[]
  selections: SelectionNode[] | null
  loc: Loc
}

export interface FragmentSpreadNode {
  kind: 'FragmentSpread'
  name: string
  directives: Directive[]
  loc: Loc
}

export interface InlineFragmentNode {
  kind: 'InlineFragment'
  typeCondition: string | null
  directives: Directive[]
  selections: SelectionNode[]
  loc: Loc
}

export type SelectionNode = FieldNode | FragmentSpreadNode | InlineFragmentNode

export interface VariableDefinition {
  name: string
  type: TypeNode
  defaultValue?: ValueNode
}

export interface OperationNode {
  kind: 'Operation'
  operation: 'query' | 'mutation' | 'subscription'
  name: string | null
  variables: VariableDefinition[]
  directives: Directive[]
  selections: SelectionNode[]
  loc: Loc
}

export interface FragmentNode {
  kind: 'Fragment'
  name: string
  typeCondition: string
  directives: Directive[]
  selections: SelectionNode[]
  loc: Loc
}

export interface Document {
  operations: OperationNode[]
  fragments: Record<string, FragmentNode>
}

export class GraphQLSyntaxError extends Error {
  constructor(message: string, public loc: Loc) {
    super(message)
  }
}

// ---------- lexer ----------

interface Token {
  kind: 'punct' | 'name' | 'int' | 'float' | 'string' | 'eof'
  value: string
  loc: Loc
}

const PUNCT = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '}', '|'])

function lex(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const loc = (): Loc => ({ line, col: i - lineStart + 1 })
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\n') {
      i++
      line++
      lineStart = i
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === ',' || ch === '﻿') {
      i++
      continue
    }
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '.' && src.slice(i, i + 3) === '...') {
      out.push({ kind: 'punct', value: '...', loc: loc() })
      i += 3
      continue
    }
    if (PUNCT.has(ch)) {
      out.push({ kind: 'punct', value: ch, loc: loc() })
      i++
      continue
    }
    if (/[_A-Za-z]/.test(ch)) {
      const start = i
      const l = loc()
      while (i < src.length && /[_A-Za-z0-9]/.test(src[i])) i++
      out.push({ kind: 'name', value: src.slice(start, i), loc: l })
      continue
    }
    if (/[-0-9]/.test(ch)) {
      const start = i
      const l = loc()
      if (src[i] === '-') i++
      while (i < src.length && /[0-9]/.test(src[i])) i++
      let isFloat = false
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        isFloat = true
        i++
        while (i < src.length && /[0-9]/.test(src[i])) i++
      }
      if (src[i] === 'e' || src[i] === 'E') {
        isFloat = true
        i++
        if (src[i] === '+' || src[i] === '-') i++
        while (i < src.length && /[0-9]/.test(src[i])) i++
      }
      out.push({ kind: isFloat ? 'float' : 'int', value: src.slice(start, i), loc: l })
      continue
    }
    if (ch === '"') {
      const l = loc()
      if (src.slice(i, i + 3) === '"""') {
        i += 3
        let raw = ''
        while (i < src.length && src.slice(i, i + 3) !== '"""') {
          if (src.slice(i, i + 4) === '\\"""') {
            raw += '"""'
            i += 4
            continue
          }
          if (src[i] === '\n') {
            line++
            lineStart = i + 1
          }
          raw += src[i++]
        }
        if (i >= src.length) throw new GraphQLSyntaxError('Unterminated block string.', l)
        i += 3
        out.push({ kind: 'string', value: blockString(raw), loc: l })
        continue
      }
      i++
      let s = ''
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') throw new GraphQLSyntaxError('Unterminated string.', l)
        if (src[i] === '\\') {
          i++
          const e = src[i++]
          if (e === 'u') {
            s += String.fromCharCode(parseInt(src.slice(i, i + 4), 16))
            i += 4
          } else s += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }[e] ?? e
          continue
        }
        s += src[i++]
      }
      if (i >= src.length) throw new GraphQLSyntaxError('Unterminated string.', l)
      i++
      out.push({ kind: 'string', value: s, loc: l })
      continue
    }
    throw new GraphQLSyntaxError(`Unexpected character "${ch}".`, loc())
  }
  out.push({ kind: 'eof', value: '', loc: loc() })
  return out
}

function blockString(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/)
  let common: number | null = null
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    const indent = l.length - l.trimStart().length
    if (indent < l.length && (common === null || indent < common)) common = indent
  }
  const out = lines.map((l, i) => (i > 0 && common ? l.slice(common) : l))
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join('\n')
}

// ---------- parser ----------

class Parser {
  private i = 0
  constructor(private tokens: Token[]) {}
  private peek(): Token {
    return this.tokens[this.i]
  }
  private next(): Token {
    return this.tokens[this.i++]
  }
  private is(kind: Token['kind'], value?: string): boolean {
    const t = this.peek()
    return t.kind === kind && (value === undefined || t.value === value)
  }
  private expect(kind: Token['kind'], value?: string): Token {
    const t = this.next()
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new GraphQLSyntaxError(`Expected ${value ?? kind}, found ${t.kind === 'eof' ? 'end of document' : JSON.stringify(t.value)}.`, t.loc)
    }
    return t
  }
  private name(): string {
    return this.expect('name').value
  }

  document(): Document {
    const doc: Document = { operations: [], fragments: {} }
    while (!this.is('eof')) {
      const t = this.peek()
      if (t.kind === 'punct' && t.value === '{') {
        doc.operations.push({ kind: 'Operation', operation: 'query', name: null, variables: [], directives: [], selections: this.selectionSet(), loc: t.loc })
      } else if (t.kind === 'name' && (t.value === 'query' || t.value === 'mutation' || t.value === 'subscription')) {
        this.next()
        const name = this.is('name') ? this.name() : null
        const variables = this.is('punct', '(') ? this.variableDefinitions() : []
        const directives = this.directives()
        doc.operations.push({ kind: 'Operation', operation: t.value as OperationNode['operation'], name, variables, directives, selections: this.selectionSet(), loc: t.loc })
      } else if (t.kind === 'name' && t.value === 'fragment') {
        this.next()
        const name = this.name()
        this.expect('name', 'on')
        const typeCondition = this.name()
        const directives = this.directives()
        doc.fragments[name] = { kind: 'Fragment', name, typeCondition, directives, selections: this.selectionSet(), loc: t.loc }
      } else {
        throw new GraphQLSyntaxError(`Unexpected ${JSON.stringify(t.value)}; expected a query, mutation, fragment or selection set.`, t.loc)
      }
    }
    return doc
  }

  private variableDefinitions(): VariableDefinition[] {
    this.expect('punct', '(')
    const out: VariableDefinition[] = []
    while (!this.is('punct', ')')) {
      this.expect('punct', '$')
      const name = this.name()
      this.expect('punct', ':')
      const type = this.type()
      let defaultValue: ValueNode | undefined
      if (this.is('punct', '=')) {
        this.next()
        defaultValue = this.value(true)
      }
      this.directives()
      out.push({ name, type, defaultValue })
    }
    this.expect('punct', ')')
    return out
  }

  private type(): TypeNode {
    let t: TypeNode
    if (this.is('punct', '[')) {
      this.next()
      t = { kind: 'List', type: this.type() }
      this.expect('punct', ']')
    } else t = { kind: 'Named', name: this.name() }
    if (this.is('punct', '!')) {
      this.next()
      t = { kind: 'NonNull', type: t }
    }
    return t
  }

  private selectionSet(): SelectionNode[] {
    this.expect('punct', '{')
    const out: SelectionNode[] = []
    while (!this.is('punct', '}')) {
      if (this.is('eof')) throw new GraphQLSyntaxError('Unexpected end of document inside a selection set.', this.peek().loc)
      out.push(this.selection())
    }
    this.expect('punct', '}')
    return out
  }

  private selection(): SelectionNode {
    const t = this.peek()
    if (this.is('punct', '...')) {
      this.next()
      if (this.is('name') && this.peek().value !== 'on') {
        const name = this.name()
        return { kind: 'FragmentSpread', name, directives: this.directives(), loc: t.loc }
      }
      let typeCondition: string | null = null
      if (this.is('name', 'on')) {
        this.next()
        typeCondition = this.name()
      }
      const directives = this.directives()
      return { kind: 'InlineFragment', typeCondition, directives, selections: this.selectionSet(), loc: t.loc }
    }
    let name = this.name()
    let alias: string | undefined
    if (this.is('punct', ':')) {
      this.next()
      alias = name
      name = this.name()
    }
    const args = this.is('punct', '(') ? this.arguments() : []
    const directives = this.directives()
    const selections = this.is('punct', '{') ? this.selectionSet() : null
    return { kind: 'Field', alias, name, args, directives, selections, loc: t.loc }
  }

  private arguments(): Argument[] {
    this.expect('punct', '(')
    const out: Argument[] = []
    while (!this.is('punct', ')')) {
      const name = this.name()
      this.expect('punct', ':')
      out.push({ name, value: this.value(false) })
    }
    this.expect('punct', ')')
    return out
  }

  private directives(): Directive[] {
    const out: Directive[] = []
    while (this.is('punct', '@')) {
      this.next()
      const name = this.name()
      out.push({ name, args: this.is('punct', '(') ? this.arguments() : [] })
    }
    return out
  }

  private value(constOnly: boolean): ValueNode {
    const t = this.next()
    switch (t.kind) {
      case 'punct':
        if (t.value === '$') {
          if (constOnly) throw new GraphQLSyntaxError('A variable cannot be used here.', t.loc)
          return { kind: 'Variable', name: this.name() }
        }
        if (t.value === '[') {
          const values: ValueNode[] = []
          while (!this.is('punct', ']')) values.push(this.value(constOnly))
          this.next()
          return { kind: 'List', values }
        }
        if (t.value === '{') {
          const fields: { name: string; value: ValueNode }[] = []
          while (!this.is('punct', '}')) {
            const name = this.name()
            this.expect('punct', ':')
            fields.push({ name, value: this.value(constOnly) })
          }
          this.next()
          return { kind: 'Object', fields }
        }
        break
      case 'int':
        return { kind: 'Int', value: t.value }
      case 'float':
        return { kind: 'Float', value: t.value }
      case 'string':
        return { kind: 'String', value: t.value }
      case 'name':
        if (t.value === 'true' || t.value === 'false') return { kind: 'Boolean', value: t.value === 'true' }
        if (t.value === 'null') return { kind: 'Null' }
        return { kind: 'Enum', value: t.value }
    }
    throw new GraphQLSyntaxError(`Unexpected ${JSON.stringify(t.value)} where a value was expected.`, t.loc)
  }
}

export function parseDocument(src: string): Document {
  return new Parser(lex(src)).document()
}
