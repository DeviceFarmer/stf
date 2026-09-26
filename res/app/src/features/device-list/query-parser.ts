export type QueryOp = '<' | '<=' | '>' | '>='

export interface QueryTerm {
  field: string | null
  op: QueryOp | null
  query: string
}

type ParserState =
  | 'termStart'
  | 'queryStart'
  | 'opLessThan'
  | 'opGreaterThan'
  | 'valueStart'
  | 'value'
  | 'quotedValue'

function isWhitespace(input: string): boolean {
  return input === ' ' || input === '\t' || input === '\n' || input === ''
}

function createTerm(): QueryTerm {
  return {field: null, op: null, query: ''}
}

export function parseQuery(input: string): QueryTerm[] {
  const terms: QueryTerm[] = []
  let term = createTerm()
  let state: ParserState = 'termStart'

  function concludeTerm() {
    term = createTerm()
    state = 'termStart'
  }

  function consume(char: string): void {
    switch (state) {
      case 'termStart':
        if (isWhitespace(char)) {
          return
        }
        terms.push(term)
        state = 'queryStart'
        consume(char)
        return
      case 'queryStart':
        if (isWhitespace(char)) {
          return
        }
        if (char === '<') {
          state = 'opLessThan'
          return
        }
        if (char === '>') {
          state = 'opGreaterThan'
          return
        }
        state = 'valueStart'
        consume(char)
        return
      case 'opLessThan':
        state = 'valueStart'
        if (char === '=') {
          term.op = '<='
          return
        }
        term.op = '<'
        consume(char)
        return
      case 'opGreaterThan':
        state = 'valueStart'
        if (char === '=') {
          term.op = '>='
          return
        }
        term.op = '>'
        consume(char)
        return
      case 'valueStart':
        if (isWhitespace(char)) {
          return
        }
        if (char === '"') {
          state = 'quotedValue'
          return
        }
        state = 'value'
        consume(char)
        return
      case 'value':
        if (isWhitespace(char)) {
          concludeTerm()
          return
        }
        if (char === ':') {
          term.field = term.query
          term.query = ''
          state = 'queryStart'
          return
        }
        term.query += char
        return
      case 'quotedValue':
        if (char === '\\') {
          return
        }
        if (char === '"') {
          concludeTerm()
          return
        }
        term.query += char
        return
      default:
        break
    }
  }

  input.split('').forEach(consume)
  return terms
}
