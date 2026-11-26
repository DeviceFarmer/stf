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
  return {plugin: plugin, handlers: handlers, push: push, channels: channels}
}

function messages(push: ReturnType<typeof setup>['push'], code: number) {
  return push.send.getCalls().map(call => wire.Envelope.decode(call.args[0][1]))
    .filter(envelope => envelope.type === code)
}

async function transaction(
  context: ReturnType<typeof setup>, type: {$code: number}, message: unknown
) {
  const before = messages(context.push, wire.TransactionDoneMessage.$code).length
  await context.handlers[type.$code]!('transaction', message)
  for (let attempt = 0; attempt < 100; attempt++) {
    const replies = messages(context.push, wire.TransactionDoneMessage.$code)
    if (replies.length > before) {
      return wire.TransactionDoneMessage.decode(replies.at(-1)!.message)
    }
    await new globalThis.Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for the ownership transaction')
}

function autoGroup(
  handlers: Record<number, Handler>, identifier: string, usage?: string, timeout?: number
) {
  var owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
  return handlers[wire.AutoGroupMessage.$code]!(
    'channel'
  , new wire.AutoGroupMessage(owner, identifier, usage, timeout)
  )
}

function lastJoin(push: ReturnType<typeof setup>['push']) {
  return wire.JoinGroupMessage.decode(messages(push, wire.JoinGroupMessage.$code).at(-1)!.message)
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

  // A reservation kept across a reboot is replayed with AutoGroupMessage, and has to come back
  // as the same kind of reservation, not as a plain one on the provider default timeout
  it('should restore the usage and timeout an autojoin carries', async function() {
    var context = setup()
    var autojoins: Array<[string, boolean]> = []
    context.plugin.on('autojoin', (identifier, joined) => autojoins.push([identifier, joined]))

    await autoGroup(context.handlers, '', 'automation', 180000)

    var joined = lastJoin(context.push)
    expect(joined.usage).to.equal('automation')
    expect(joined.timeout).to.equal(180000)
    expect(joined.leaseId).to.equal(null)
    expect(context.channels.register.firstCall.args[1].timeout).to.equal(180000)
    expect(autojoins).to.eql([['', true]])
  })

  it('should fall back to the provider timeout for an autojoin without one', async function() {
    var context = setup()

    await autoGroup(context.handlers, 'fingerprint')

    var joined = lastJoin(context.push)
    expect(joined.usage).to.equal(null)
    expect(joined.timeout).to.equal(null)
    expect(context.channels.register.firstCall.args[1].timeout).to.equal(1000)
  })

  it('should report the requested timeout, not the resolved one, on join', async function() {
    var context = setup()
    var owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')

    await transaction(context, wire.GroupMessage
    , new wire.GroupMessage(owner, 120000, [], 'automation'))
    expect(lastJoin(context.push)).to.include({usage: 'automation', timeout: 120000})
    await context.plugin.leave('test')

    await transaction(context, wire.GroupMessage, new wire.GroupMessage(owner, null, []))
    expect(lastJoin(context.push).timeout).to.equal(null)
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

  it('fences manual commands and competing reservations until awaited cleanup completes',
    async function() {
      const {plugin, push} = setup()
      const owner = new wire.OwnerMessage('operator@example.test', 'Operator', 'local')
      const {reservationId} = await plugin.join(owner)
      expect(plugin.isManualOwner(owner.email, reservationId!)).to.equal(true)
      let beginCleanup!: () => void
        , finishCleanup!: () => void
      const entered = new Promise<void>(resolve => {
        beginCleanup = resolve
      })
      plugin.beforeLeave(() => new Promise<void>(resolve => {
        finishCleanup = resolve
        beginCleanup()
      }))
      const leaving = plugin.leave('ungroup_request', reservationId)
      expect(plugin.isManualOwner(owner.email, reservationId!)).to.equal(false)
      const accepted = await plugin.join(owner).then(() => true, () => false)
      expect(accepted).to.equal(false)
      expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(0)
      await entered
      finishCleanup()
      await leaving
      expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(1)
    })

  it('holds ownership on cleanup failure and permits a matched release retry', async function() {
    const {plugin, push} = setup()
    const owner = new wire.OwnerMessage('operator@example.test', 'Operator', 'local')
    const group = await plugin.join(owner)
    let clean = false
    plugin.beforeLeave(async() => {
      if (!clean) {
        throw new Error('Sensor mode could not be restored')
      }
    })
    const failed = await plugin.leave('automatic_timeout').then(() => false, () => true)
    expect(failed).to.equal(true)
    expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(0)
    expect(await plugin.get()).to.equal(group)

    clean = true
    await plugin.leave('ungroup_request', group.reservationId)
    expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(1)
  })

  it('retries an expired reservation if its cleanup failed', async function() {
    const {plugin, push, channels} = setup()
    const owner = new wire.OwnerMessage('operator@example.test', 'Operator', 'local')
    await plugin.join(owner)
    let attempts = 0
    plugin.beforeLeave(async() => {
      if (++attempts === 1) {
        throw new Error('Sensor mode could not be restored')
      }
    })

    channels.emit('timeout', owner.group)
    for (let attempt = 0; attempt < 100 && channels.register.callCount === 1; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    expect(channels.register.callCount).to.equal(2)
    expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(0)

    const released = new Promise(resolve => plugin.once('leave', resolve))
    channels.emit('timeout', owner.group)
    await released
    expect(messages(push, wire.LeaveGroupMessage.$code)).to.have.length(1)
  })

  it('fences the correct owner of a managed or replayed automation reservation', async function() {
    const {plugin} = setup()
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const replay = await plugin.join(owner, 10000, 'automation')
    expect(plugin.isManualOwner(owner.email, replay.reservationId!)).to.equal(false)
    await plugin.leave('test')
    const managed = await plugin.join(owner, 10000, 'automation', 'job', 'lease')
    expect(plugin.isManualOwner(owner.email, managed.reservationId!)).to.equal(false)
    await plugin.leave('test')
  })

  it('refuses a delayed release after the same user acquired a new reservation', async function() {
    const context = setup()
    const owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
    const first = await context.plugin.join(owner)
    await context.plugin.leave('test')
    const second = await context.plugin.join(owner)
    const stale = await transaction(context, wire.UngroupMessage,
      new wire.UngroupMessage([], first.reservationId))
    expect((await context.plugin.get()).reservationId).to.equal(second.reservationId)
    expect(stale.success).to.equal(false)
    const current = await transaction(context, wire.UngroupMessage,
      new wire.UngroupMessage([], second.reservationId))
    expect(current.success).to.equal(true)
    await context.plugin.get().then(() => {
      throw new Error('Expected no owner')
    }, () => undefined)
  })

  it('acknowledges the reservation while preserving the coordinator lease', async function() {
    const context = setup()
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const reply = await transaction(context, wire.GroupMessage,
      new wire.GroupMessage(owner, 10000, [], 'automation', 'lease-a'))
    expect(reply.success).to.equal(true)
    const announced = messages(context.push, wire.JoinGroupMessage.$code)
    expect(announced).to.have.length(1)
    const joined = wire.JoinGroupMessage.decode(announced[0]!.message)
    expect(joined.usage).to.equal('automation')
    expect(joined.leaseId).to.equal('lease-a')
    expect(joined.owner.reservationId).to.be.a('string').with.length(36)
    expect(JSON.parse(reply.body!).owner.reservationId).to.equal(joined.owner.reservationId)
    expect((await context.plugin.get()).reservationId).to.equal(joined.owner.reservationId)
    expect(owner.reservationId).to.equal(null)
    const legacyRelease = await transaction(context, wire.UngroupMessage,
      new wire.UngroupMessage([]))
    expect(legacyRelease.success).to.equal(false)
    expect((await context.plugin.get()).reservationId).to.equal(joined.owner.reservationId)
    const renewal = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'renew', 10000))
    expect(renewal.success).to.equal(true)
    const release = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'release'))
    expect(release.success).to.equal(true)
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)
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

  it('refuses another capture while the coordinator lease is pending', async function() {
    const context = setup()
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const capture = context.plugin.join(owner, 10000, 'automation', undefined, 'lease-a')
    const competing = await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-b')
      .then(() => true, () => false)
    expect(competing).to.equal(false)
    const acquired = await capture
    const joined = messages(context.push, wire.JoinGroupMessage.$code)
    expect(joined).to.have.length(1)
    const message = wire.JoinGroupMessage.decode(joined[0]!.message)
    expect(message.leaseId).to.equal('lease-a')
    expect(message.owner.reservationId).to.equal(acquired.reservationId)
    await context.plugin.leave('test_cleanup')
  })

  it('refuses renew or release of an old lease after a replacement capture', async function() {
    const context = setup()
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const previous = await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-a')
    await context.plugin.leave('test_cleanup')
    const replacement = await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-b')
    expect(replacement.reservationId).to.not.equal(previous.reservationId)

    for (const action of ['renew', 'release']) {
      const reply = await transaction(context, wire.AutomationLeaseMessage,
        new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', action, 10000))
      expect(reply.success).to.equal(false)
      expect(await context.plugin.get()).to.equal(replacement)
    }
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)

    const release = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-b', 'release'))
    expect(release.success).to.equal(true)
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(2)
  })

  it('releases an expired lease when the coordinator is absent', async function() {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
    try {
      const context = setup()
      const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
      const acquired = await context.plugin.join(owner, 10, 'automation', undefined, 'lease-a')
      const left = new Promise(resolve => context.plugin.once('leave', resolve))
      await clock.tickAsync(11)
      await left

      const messagesSent = messages(context.push, wire.LeaveGroupMessage.$code)
      expect(messagesSent).to.have.length(1)
      const leftGroup = wire.LeaveGroupMessage.decode(messagesSent[0]!.message)
      expect(leftGroup.owner.reservationId).to.equal(acquired.reservationId)
      expect(leftGroup.reason).to.equal('automatic_timeout')
      expect(leftGroup.leaseId).to.equal('lease-a')
      const unowned = await context.plugin.get().then(() => false, () => true)
      expect(unowned).to.equal(true)
    }
    finally {
      clock.restore()
    }
  })
})
