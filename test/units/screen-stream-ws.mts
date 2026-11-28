import EventEmitter from 'node:events'
import {expect} from 'chai'
import sinon from 'sinon'
import WebSocket from 'ws'
import BroadcastSet from '../../lib/units/device/plugins/screen/util/broadcastset.js'
import {matchesDisplayBanner} from '../../lib/units/device/plugins/screen/util/banner.js'
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

  it('accepts legacy size and forwards a revision only for a subscribed client', function() {
    const ws = new MockWebSocket()
    const broadcastSet = new BroadcastSet<ScreenClient>()
    const updateProjection = sinon.spy()
    handleScreenConnection(
      ws as unknown as WebSocket, broadcastSet, {banner: null, updateProjection}, 1000
    )

    ws.emit('message', 'size 640x480')
    ws.emit('message', 'size primary-rev 800x480')
    expect(updateProjection.callCount).to.equal(1)
    expect(updateProjection.firstCall.args.slice(0, 2)).to.deep.equal([640, 480])
    expect(updateProjection.firstCall.args[2]).to.be.undefined

    ws.emit('message', 'on')
    ws.emit('message', 'size primary-rev 800x480')
    expect(updateProjection.secondCall.args).to.deep.equal([800, 480, 'primary-rev'])
    ws.emit('message', 'off')
    ws.emit('message', 'size old-rev 900x480')
    expect(updateProjection.callCount).to.equal(2)
    ws.terminate()
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

describe('Fold4 capture banner', function() {
  const display = {id: 0, width: 904, height: 2316, rotation: 0, revision: 'cover'}
  const banner = {
    version: 1, length: 24, pid: 1
  , realWidth: 904, realHeight: 2316, virtualWidth: 390, virtualHeight: 1000, orientation: 0
  , quirks: {alwaysUpright: true, dumb: false, tear: false}
  }

  it('matches the active physical panel and tolerates integer projection rounding', function() {
    expect(matchesDisplayBanner(banner, display)).to.equal(true)
    const wrongPanel = {...banner, realWidth: 1812, realHeight: 2176}
    expect(matchesDisplayBanner(wrongPanel, display)).to.equal(false)
    expect(matchesDisplayBanner({...banner, virtualWidth: 600}, display)).to.equal(false)
  })

  it('normalizes both minicap-apk landscape axes for an upright banner', function() {
    const rotated = {...banner, orientation: 90, realWidth: 2316, realHeight: 904
    , virtualWidth: 1000, virtualHeight: 390}
    const landscape = {...display, rotation: 90}
    expect(matchesDisplayBanner(rotated, landscape)).to.equal(true)
    expect(matchesDisplayBanner({...rotated, orientation: 0}, landscape)).to.equal(false)
  })
})
