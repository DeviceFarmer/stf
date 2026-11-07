import EventEmitter from 'node:events'
import {expect} from 'chai'
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
  }

  terminate() {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  }
}

describe('screen stream WebSocket error handling (#36)', function() {
  it('handles ECONNRESET error without crashing and removes client from broadcastSet', function() {
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

    // Simulate browser refresh causing ECONNRESET
    const resetError = new Error('read ECONNRESET')
    expect(() => {
      ws.emit('error', resetError)
    }).to.not.throw()

    // Client should be removed from broadcastSet
    expect(broadcastSet.keys()).to.have.lengthOf(0)
  })

  it('handles client close cleanly and removes client from broadcastSet', function() {
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

    ws.emit('close')
    expect(broadcastSet.keys()).to.have.lengthOf(0)
  })
})
