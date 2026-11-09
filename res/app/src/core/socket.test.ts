import {describe, expect, it, vi} from 'vitest'

let ioOptions: unknown = null
vi.mock('socket.io-client', () => ({
  io: (_url: string, options: unknown) => {
    ioOptions = options
    return {
      on: vi.fn()
      , off: vi.fn()
      , emit: vi.fn()
    }
  }
}))

describe('socket configuration', () => {
  it('enables automatic reconnection with backoff', async() => {
    const {getSocket} = await import('./socket')
    getSocket()
    expect(ioOptions).toMatchObject({
      reconnection: true
      , reconnectionAttempts: Infinity
      , reconnectionDelay: 1000
      , reconnectionDelayMax: 5000
      , randomizationFactor: 0.5
      , transports: ['websocket']
    })
  })
})
