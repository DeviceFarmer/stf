import Bluebird from 'bluebird'
import 'rethinkdb'

declare module 'rethinkdb' {
  export const Error: {
    RqlDriverError: new(message?: string) => ReqlDriverError
  }

  export function connect(opts: ConnectionOptions): Bluebird<Connection>
  export function tableCreate(
    name: string
  , options?: {primaryKey?: string}
  ): Operation<CreateResult>
  export function literal(value?: object): Expression<unknown>
  export function epochTime(time: number): Expression<Time>
  export function branch(
    test: Expression<boolean>
  , trueBranch: unknown
  , falseBranch: unknown
  ): Expression<any>

  interface ConnectionOptions {
    authKey?: string | undefined
  }

  interface Connection {
    db?: string
    removeListener(event: string, cb: Function): void
  }

  type RunCallback<T> = (err: Error, result: T) => void

  interface Operation<T> {
    run(conn: Connection, opts?: Partial<OperationOptions> | RunCallback<T>): Bluebird<T>
  }

  interface ValueChange {
    new_val: any
    old_val: any
  }

  interface WriteResult {
    changes?: ValueChange[]
  }

  interface WriteResultWithChanges extends WriteResult {
    changes: ValueChange[]
  }

  interface Writeable {
    update(
      obj: object
    , options: {returnChanges: true | 'always'}
    ): Operation<WriteResultWithChanges>
    update(
      obj: object | ExpressionFunction<unknown>
    , options?: {returnChanges?: boolean | 'always'}
    ): Operation<WriteResult>
  }

  interface Expression<T> {
    append(value: unknown): Expression<unknown[]>
    setInsert(value: unknown): Expression<unknown[]>
    setIntersection(values: unknown): Expression<unknown[]>
    setDifference(values: unknown): Expression<unknown[]>
    filter(predicate: ExpressionFunction<boolean>): Expression<unknown[]>
    getField<K extends keyof T & string>(field: K): Expression<T[K]>
    isEmpty(): Expression<boolean>
    contains(value: unknown): Expression<boolean>
    le(value: unknown): Expression<boolean>
    default(value: unknown): Expression<T>
    hasFields(...selectors: Array<string | object>): Expression<boolean>
    merge(value: unknown): Expression<unknown>
    map(transform: ExpressionFunction<unknown>): Expression<unknown[]>
    nth(index: number): Expression<unknown>
  }

  interface Table {
    insert(
      obj: object
    , options: {returnChanges: true | 'always'}
    ): Operation<WriteResultWithChanges>
    getAll(key: unknown, index?: Index): Sequence
  }

  interface Sequence {
    (field: string): Sequence
    pluck(...selectors: Array<string | object>): Sequence
  }
}
