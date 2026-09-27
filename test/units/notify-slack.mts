import EventEmitter from 'node:events'

import {expect} from 'chai'
import sinon from 'sinon'
import {WebClient} from '@slack/web-api'

import notifySlack from '../../lib/units/notify/slack.js'
import lifecycle from '../../lib/util/lifecycle.js'
import logger from '../../lib/util/logger.js'
import zmqutil from '../../lib/util/zmqutil.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'

type FakeSocket = EventEmitter & {subscribe: sinon.SinonSpy, close: sinon.SinonSpy}

describe('Slack notifier', function() {
  var socket: FakeSocket, apiCall: sinon.SinonStub, clock: sinon.SinonFakeTimers
    , cleanup: (() => unknown) | null

  beforeEach(function() {
    socket = new EventEmitter() as FakeSocket
    socket.subscribe = sinon.spy()
    socket.close = sinon.spy()
    sinon.stub(zmqutil, 'socket').returns(socket as unknown as ReturnType<typeof zmqutil.socket>)
    sinon.stub(lifecycle, 'observe').callsFake(function(fn) {
      cleanup = fn
    })
    apiCall = sinon.stub(WebClient.prototype, 'apiCall').resolves({ok: true})
    clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  })

  afterEach(function() {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
    sinon.restore()
  })

  it('should initialize the SDK, filter messages and send the formatted notification', function() {
    notifySlack({
      token: 'test-token'
    , channel: 'test-channel'
    , priority: logger.Level.WARNING
    , endpoints: {sub: []}
    })

    expect(socket.subscribe.calledWith(wireutil.global)).to.equal(true)
    socket.emit('message', wireutil.global, wireutil.envelope(new wire.DeviceLogMessage(
      'serial', Date.now(), logger.Level.INFO, 'test', 123, 'ignored', 'device'
    )))
    socket.emit('message', wireutil.global, wireutil.envelope(new wire.DeviceLogMessage(
      'serial', Date.now(), logger.Level.WARNING, 'test', 123, 'message', 'device'
    )))
    expect(apiCall.called).to.equal(false)
    clock.tick(1000)

    expect(apiCall.calledOnce).to.equal(true)
    expect(apiCall.firstCall.args[0]).to.equal('chat.postMessage')
    expect(apiCall.firstCall.args[1]).to.include({
      channel: 'test-channel'
    , text: '>>> *WRN/test* 123 [*device*] `message`'
    , username: 'STF'
    })

    cleanup!()
    cleanup = null
    expect(socket.close.calledOnce).to.equal(true)
  })
})
