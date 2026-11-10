import EventEmitter from 'node:events'
import {expect} from 'chai'
import sinon from 'sinon'
import WebSocket from 'ws'
import BroadcastSet from '../../lib/units/device/plugins/screen/util/broadcastset.js'
import {
  handleScreenConnection
, type ScreenClient
} from '../../lib/units/device/plugins/screen/stream.js'

class MockWebSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN
  sent: Array<string | Buffer> = []

  send(data: string | Buffer, _options: unknown, callback?: (err?: Error) => void) {
    this.sent.push(data)
    if (callback) {
      callback()
    }
    return
  }

  terminate() {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  }
}

describe('screen stream WebSocket error handling (#36)', function() {
  let clock: sinon.SinonFakeTimers

  beforeEach(function() {
    clock = sinon.useFakeTimers()
  })

  afterEach(function() {
    clock.restore()
  })

  it('handles ECONNRESET error without crashing and cleans up client and timer', function() {
    const ws = new MockWebSocket()
    const broadcastSet = new BroadcastSet<ScreenClient>()
    const frameProducer = {
      banner: {quirks: {alwaysUpright: false}}
    , updateProjection: () => {}
    }

    handleScreenConnection(
      ws as unknown as WebSocket
    , broadcastSet
    , frameProducer
    , 1000
    )

    // Client requests screen frames
    ws.emit('message', 'on')
    expect(broadcastSet.keys()).to.have.lengthOf(1)

    // Advance clock to verify ping is ticking
    clock.tick(1000)
    expect(ws.sent).to.include('ping')
    const sentCountBefore = ws.sent.length

    // Simulate browser refresh causing ECONNRESET
    const resetError = new Error('read ECONNRESET')
    expect(() => {
      ws.emit('error', resetError)
    }).to.not.throw()

    // Client should be removed from broadcastSet
    expect(broadcastSet.keys()).to.have.lengthOf(0)

    // Advancing clock should NOT trigger further pings (ping timer was cleared)
    clock.tick(5000)
    expect(ws.sent.length).to.equal(sentCountBefore)
  })

  it('handles client close cleanly and cleans up client and timer', function() {
    const ws = new MockWebSocket()
    const broadcastSet = new BroadcastSet<ScreenClient>()
    const frameProducer = {
      banner: {quirks: {alwaysUpright: false}}
    , updateProjection: () => {}
    }

    handleScreenConnection(
      ws as unknown as WebSocket
    , broadcastSet
    , frameProducer
    , 1000
    )

    ws.emit('message', 'on')
    expect(broadcastSet.keys()).to.have.lengthOf(1)

    clock.tick(1000)
    expect(ws.sent).to.include('ping')
    const sentCountBefore = ws.sent.length

    ws.emit('close')
    expect(broadcastSet.keys()).to.have.lengthOf(0)

    // Verify timer cancelled
    clock.tick(5000)
    expect(ws.sent.length).to.equal(sentCountBefore)
  })

  it('handles send error on start notifier without throwing unhandled rejection', async function() {
    const ws = new MockWebSocket()
    // Simulate send failure (e.g. socket destroyed immediately)
    ws.send = (_data: string | Buffer, _options: unknown, callback?: (err?: Error) => void) => {
      if (callback) {
        callback(new Error('write EPIPE'))
      }
      return
    }

    const broadcastSet = new BroadcastSet<ScreenClient>()
    const frameProducer = {
      banner: {quirks: {alwaysUpright: false}}
    , updateProjection: () => {}
    }

    handleScreenConnection(
      ws as unknown as WebSocket
    , broadcastSet
    , frameProducer
    , 1000
    )

    // Turning on triggers onStart -> wsStartNotifier()
    expect(() => {
      ws.emit('message', 'on')
    }).to.not.throw()

    const client = broadcastSet.get(broadcastSet.keys()[0]!)
    expect(client).to.exist
    // onStart should catch the send error and not reject
    let threw = false
    try {
      await client!.onStart()
    }
    catch {
      threw = true
    }
    expect(threw).to.be.false
  })

  it('rejects send cleanly without hanging when socket is closing or closed', async function() {
    const ws = new MockWebSocket()
    const broadcastSet = new BroadcastSet<ScreenClient>()
    const frameProducer = {
      banner: {quirks: {alwaysUpright: false}}
    , updateProjection: () => {}
    }

    handleScreenConnection(
      ws as unknown as WebSocket
    , broadcastSet
    , frameProducer
    , 1000
    )

    ws.emit('message', 'on')
    const client = broadcastSet.get(broadcastSet.keys()[0]!)
    expect(client).to.exist

    // Socket enters CLOSING state
    ws.readyState = WebSocket.CLOSING
    let closingError: Error | undefined
      , closedError: Error | undefined
    try {
      await client!.onFrame(Buffer.from('frame-closing'))
    }
    catch (err) {
      closingError = err as Error
    }
    expect(closingError).to.exist
    expect(closingError!.message).to.include('CLOSING')

    // Socket enters CLOSED state
    ws.readyState = WebSocket.CLOSED
    try {
      await client!.onFrame(Buffer.from('frame-closed'))
    }
    catch (err) {
      closedError = err as Error
    }
    expect(closedError).to.exist
    expect(closedError!.message).to.include('CLOSED')
    expect(broadcastSet.keys()).to.have.lengthOf(0)
  })
})
