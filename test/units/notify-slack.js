var EventEmitter = require('events')

var expect = require('chai').expect
var sinon = require('sinon')
var WebClient = require('@slack/web-api').WebClient

var notifySlack = require('../../lib/units/notify/slack')
var lifecycle = require('../../lib/util/lifecycle')
var logger = require('../../lib/util/logger')
var zmqutil = require('../../lib/util/zmqutil')
var wire = require('../../lib/wire')
var wireutil = require('../../lib/wire/util')

describe('Slack notifier', function() {
  var socket, apiCall, clock, cleanup

  beforeEach(function() {
    socket = new EventEmitter()
    socket.subscribe = sinon.spy()
    socket.close = sinon.spy()
    sinon.stub(zmqutil, 'socket').returns(socket)
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

    cleanup()
    cleanup = null
    expect(socket.close.calledOnce).to.equal(true)
  })
})
