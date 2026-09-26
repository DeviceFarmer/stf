import {v4 as uuidv4} from 'uuid'
import {emit, getSocket} from './socket'

export interface TransactionMessage {
  seq: number
  source: string
  success?: boolean
  data?: any
  body?: string
  progress?: number
}

export interface TransactionResult<S = any> {
  source: S
  device: S
  settled: boolean
  success: boolean
  progress: number
  error: any
  data: any[]
  lastData: any
  body: any
}

export class TransactionError extends Error {
  readonly code: any
  readonly result: TransactionResult

  constructor(result: TransactionResult) {
    super(typeof result.error === 'string' ? result.error : String(result.error))
    this.name = 'TransactionError'
    this.code = result.error
    this.result = result
  }
}

export type ProgressPromise<T, P = T> = Promise<T> & {
  progressed(listener: (progress: P) => void): ProgressPromise<T, P>
}

function withProgress<T, P>(
  promise: Promise<T>
, setListener: (listener: (progress: P) => void) => void
): ProgressPromise<T, P> {
  const extended = promise as ProgressPromise<T, P>
  extended.progressed = (listener) => {
    setListener(listener)
    return extended
  }
  return extended
}

function createResult<S>(source: S): TransactionResult<S> {
  return {
    source
    , device: source
    , settled: false
    , success: false
    , progress: 0
    , error: null
    , data: []
    , lastData: null
    , body: null
  }
}

function createChannel(): string {
  return `tx.${uuidv4()}`
}

class PendingResult<S> {
  readonly promise: Promise<TransactionResult<S>>
  private resolve!: (result: TransactionResult<S>) => void
  private reject!: (error: TransactionError) => void
  private seq = 0
  private last = Infinity
  private unplaced: Array<TransactionMessage | null> = []

  constructor(readonly result: TransactionResult<S>, private onProgress: () => void) {
    const promise = new Promise<TransactionResult<S>>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    this.promise = promise.finally(() => {
      result.settled = true
      result.progress = 100
    })
  }

  private readQueue() {
    const result = this.result
    let foundAny = false
    let message: TransactionMessage | null | undefined

    while (this.seq <= this.last && (message = this.unplaced[this.seq])) {
      this.unplaced[this.seq] = null

      if (this.seq === this.last) {
        result.success = Boolean(message.success)

        if (message.body) {
          result.body = JSON.parse(message.body)
        }

        if (result.success) {
          if (message.data) {
            result.lastData = result.data[this.seq] = message.data
          }
          this.resolve(result)
        }
        else {
          result.lastData = result.error = message.data
          this.reject(new TransactionError(result))
        }
        return
      }

      if (message.progress) {
        result.progress = message.progress
      }

      foundAny = true
      result.lastData = result.data[this.seq++] = message.data
    }

    if (foundAny) {
      this.onProgress()
    }
  }

  progress(message: TransactionMessage) {
    this.unplaced[message.seq] = message
    this.readQueue()
  }

  done(message: TransactionMessage) {
    this.last = message.seq
    this.unplaced[message.seq] = message
    this.readQueue()
  }

  cancel(message: TransactionMessage) {
    if (!this.result.settled) {
      this.last = message.seq = this.seq
      this.unplaced[message.seq] = message
      this.readQueue()
    }
  }
}

function listen(
  channel: string
, handlers: {
    done: (data: TransactionMessage) => void
    progress: (data: TransactionMessage) => void
    cancel: (data: TransactionMessage) => void
  }
): () => void {
  const socket = getSocket()
  const done = (someChannel: string, data: TransactionMessage) => {
    if (someChannel === channel) {
      handlers.done(data)
    }
  }
  const progress = (someChannel: string, data: TransactionMessage) => {
    if (someChannel === channel) {
      handlers.progress(data)
    }
  }
  const cancel = (someChannel: string, data: TransactionMessage) => {
    if (someChannel === channel) {
      handlers.cancel(data)
    }
  }
  socket.on('tx.done', done)
  socket.on('tx.progress', progress)
  socket.on('tx.cancel', cancel)
  return () => {
    socket.off('tx.done', done)
    socket.off('tx.progress', progress)
    socket.off('tx.cancel', cancel)
    emit('tx.cleanup', channel)
  }
}

export interface SingleTransaction<S> {
  channel: string
  result: TransactionResult<S>
  results: Array<TransactionResult<S>>
  promise: ProgressPromise<TransactionResult<S>>
}

export interface MultiTransaction<S> {
  channel: string
  results: Array<TransactionResult<S>>
  promise: ProgressPromise<Array<TransactionResult<S>>>
}

export function createTransaction<S = any>(target: S): SingleTransaction<S> {
  const channel = createChannel()
  let notify: ((result: TransactionResult<S>) => void) | null = null
  const result = createResult(target)
  const pending = new PendingResult(result, () => notify?.(result))
  const unlisten = listen(channel, {
    done: (data) => pending.done(data)
    , progress: (data) => pending.progress(data)
    , cancel: (data) => pending.cancel(data)
  })

  const promise = pending.promise
    .finally(unlisten)
    .then(() => result)

  return {
    channel
    , result
    , results: [result]
    , promise: withProgress(promise, (listener) => {
      notify = listener
    })
  }
}

export function createMultiTransaction<S extends Record<string, any>>(
  targets: S[]
, id: keyof S = 'serial'
): MultiTransaction<S> {
  const channel = createChannel()
  const pending: Record<string, PendingResult<S>> = Object.create(null)
  const results: Array<TransactionResult<S>> = []
  let notify: ((results: Array<TransactionResult<S>>) => void) | null = null

  const unlisten = listen(channel, {
    done: (data) => pending[data.source]?.done(data)
    , progress: (data) => pending[data.source]?.progress(data)
    , cancel: (data) => {
      for (const source of Object.keys(pending)) {
        pending[source]!.cancel(data)
      }
    }
  })

  const settled = targets.map((target) => {
    const result = createResult(target)
    const pendingResult = new PendingResult(result, () => notify?.(results))
    pending[String(target[id])] = pendingResult
    results.push(result)
    return pendingResult.promise.then(() => undefined, () => undefined)
  })

  const promise = Promise.all(settled)
    .finally(unlisten)
    .then(() => results)

  return {
    channel
    , results
    , promise: withProgress(promise, (listener) => {
      notify = listener
    })
  }
}

export function punch(channel: string, timeout = 5000): Promise<string> {
  const socket = getSocket()
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('tx.punch', listener)
      reject(new Error('Punch timed out'))
    }, timeout)

    function listener(someChannel: string) {
      if (someChannel === channel) {
        clearTimeout(timer)
        socket.off('tx.punch', listener)
        resolve(channel)
      }
    }

    socket.on('tx.punch', listener)
    emit('tx.punch', channel)
  })
}
