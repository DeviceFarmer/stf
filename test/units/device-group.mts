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
  , releaseWakeLock: sinon.spy()
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

  it('assigns a fresh reservation id without changing the caller owner', async function() {
    const {plugin} = setup()
    const owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
    const first = await plugin.join(owner)
    expect(first.reservationId).to.be.a('string').with.length(36)
    expect(owner.reservationId).to.equal(null)
    expect((await plugin.join(owner)).reservationId).to.equal(first.reservationId)
    await plugin.leave('test')
    const second = await plugin.join(owner)
    expect(second.reservationId).to.not.equal(first.reservationId)
  })

  it('refuses a delayed release after the same user acquired a new reservation', async function() {
    const {plugin, handlers, push} = setup()
    const owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
    const first = await plugin.join(owner)
    await plugin.leave('test')
    const second = await plugin.join(owner)
    await handlers[wire.UngroupMessage.$code]!(
      'transaction', new wire.UngroupMessage([], first.reservationId)
    )
    expect((await plugin.get()).reservationId).to.equal(second.reservationId)
    let envelope = wire.Envelope.decode(push.send.lastCall.args[0][1])
    expect(wire.TransactionDoneMessage.decode(envelope.message).success).to.equal(false)
    await handlers[wire.UngroupMessage.$code]!(
      'transaction', new wire.UngroupMessage([], second.reservationId)
    )
    for (let i = 0; i < 100; i++) {
      envelope = wire.Envelope.decode(push.send.lastCall.args[0][1])
      if (wire.TransactionDoneMessage.decode(envelope.message).success) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    expect(wire.TransactionDoneMessage.decode(envelope.message).success).to.equal(true)
    await plugin.get().then(() => {
      throw new Error('Expected no owner')
    }, () => undefined)
  })

  it('acknowledges the exact acquired reservation, including idempotent joins', async function() {
    const {plugin, handlers, push} = setup()
    const owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
    const current = await plugin.join(owner)
    await handlers[wire.GroupMessage.$code]!('transaction', new wire.GroupMessage(owner))
    for (let i = 0; i < 100; i++) {
      const envelope = wire.Envelope.decode(push.send.lastCall.args[0][1])
      if (envelope.type === wire.TransactionDoneMessage.$code) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    const envelope = wire.Envelope.decode(push.send.lastCall.args[0][1])
    const response = wire.TransactionDoneMessage.decode(envelope.message)
    expect(response.success).to.equal(true)
    expect(JSON.parse(response.body!).owner.reservationId).to.equal(current.reservationId)
  })
})
