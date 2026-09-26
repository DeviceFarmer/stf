import events from 'node:events'

import {expect} from 'chai'
import sinon from 'sinon'
import type Bluebird from 'bluebird'

import wire from '../../lib/wire/index.js'
import lifecycle from '../../lib/util/lifecycle.js'
import group from '../../lib/units/device/plugins/group.js'
import type {GroupPlugin} from '../../lib/types/device-plugins.js'

type Handler = (channel: string, message: unknown) => Bluebird<void>

function setup() {
  var handlers: Record<number, Handler> = {}
  var router = {
    on: function(type: {$code: number}, handler: Handler) {
      handlers[type.$code] = handler
      return router
    }
  }
  var push = {send: sinon.spy()}
  var sub = {subscribe: sinon.spy(), unsubscribe: sinon.spy()}
  var channels = Object.assign(new events.EventEmitter(), {
    register: sinon.spy()
  , unregister: sinon.spy()
  })
  var service = {
    wake: sinon.spy()
  , acquireWakeLock: sinon.spy()
  }
  var plugin = group.invoke(
    {serial: 'test-device', groupTimeout: 1000}
  , {channel: 'solo-channel'}
  , {}
  , service
  , router
  , push
  , sub
  , channels
  ) as GroupPlugin
  return {plugin: plugin, handlers: handlers, push: push}
}

function autoGroup(handlers: Record<number, Handler>, identifier: string) {
  var owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
  return handlers[wire.AutoGroupMessage.$code]!(
    'channel'
  , new wire.AutoGroupMessage(owner, identifier)
  )
}

describe('Device group plugin', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('should pass the autojoin identifier to join listeners', function() {
    var context = setup()
    var joins: Array<string | undefined> = []
    context.plugin.on('join', function(joined, identifier) {
      joins.push(identifier)
    })

    return autoGroup(context.handlers, 'fingerprint').then(function() {
      expect(joins).to.eql(['fingerprint'])
    })
  })

  it('should not send the autojoin identifier as the usage', function() {
    var context = setup()

    return autoGroup(context.handlers, 'fingerprint').then(function() {
      var envelope = wire.Envelope.decode(context.push.send.firstCall.args[0][1])
      var message = wire.JoinGroupMessage.decode(envelope.message)
      expect(message.usage).to.not.equal('fingerprint')
    })
  })
})
