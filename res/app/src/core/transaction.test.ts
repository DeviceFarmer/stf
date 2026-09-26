import {beforeEach, describe, expect, it, vi} from 'vitest'

const handlers = new Map<string, Set<(...args: any[]) => void>>()
const emitted: unknown[][] = []

vi.mock('./socket', () => ({
  getSocket: () => ({
    on: (event: string, handler: (...args: any[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set())
      }
      handlers.get(event)?.add(handler)
    }
    , off: (event: string, handler: (...args: any[]) => void) => {
      handlers.get(event)?.delete(handler)
    }
  })
  , emit: (...args: unknown[]) => {
    emitted.push(args)
  }
}))

const {createMultiTransaction, createTransaction, TransactionError} = await import('./transaction')

function fire(event: string, ...args: unknown[]) {
  handlers.get(event)?.forEach((handler) => handler(...args))
}

describe('createTransaction', () => {
  beforeEach(() => {
    handlers.clear()
    emitted.length = 0
  })

  it('resolves with ordered progress data and the final body', async() => {
    const tx = createTransaction({serial: 'a'})
    const progress: unknown[] = []
    tx.promise.progressed((result) => progress.push(result.lastData))

    fire('tx.progress', tx.channel, {seq: 1, source: 'a', data: 'second', progress: 50})
    fire('tx.progress', tx.channel, {seq: 0, source: 'a', data: 'first'})
    fire('tx.done', tx.channel, {seq: 2, source: 'a', success: true, data: 'done', body: '{"ok":1}'})

    const result = await tx.promise
    expect(result.success).toBe(true)
    expect(result.data).toEqual(['first', 'second', 'done'])
    expect(result.body).toEqual({ok: 1})
    expect(result.settled).toBe(true)
    expect(result.progress).toBe(100)
    expect(progress).toEqual(['second'])
    expect(emitted).toContainEqual(['tx.cleanup', tx.channel])
    expect(handlers.get('tx.done')?.size).toBe(0)
  })

  it('ignores messages for other channels and rejects with TransactionError on failure', async() => {
    const tx = createTransaction({serial: 'a'})
    fire('tx.done', 'tx.other', {seq: 0, source: 'a', success: true})
    fire('tx.done', tx.channel, {seq: 0, source: 'a', success: false, data: 'fail_reason'})

    const error = await tx.promise.catch((caught) => caught)
    expect(error).toBeInstanceOf(TransactionError)
    expect(error.code).toBe('fail_reason')
  })

  it('settles every target of a multi transaction even when one fails', async() => {
    const tx = createMultiTransaction([{serial: 'a'}, {serial: 'b'}])
    fire('tx.done', tx.channel, {seq: 0, source: 'b', success: false, data: 'nope'})
    fire('tx.done', tx.channel, {seq: 0, source: 'a', success: true, data: 'yes'})

    const results = await tx.promise
    expect(results.map((result) => [result.source.serial, result.success])).toEqual([['a', true], ['b', false]])
    expect(results[1]!.error).toBe('nope')
  })
})
