import events from 'node:events'
import {Readable} from 'node:stream'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import wire from '../../lib/wire/index.js'
import lifecycle from '../../lib/util/lifecycle.js'
import group from '../../lib/units/device/plugins/group.js'
import type {GroupPlugin} from '../../lib/types/device-plugins.js'

type Handler = (channel: string, message: unknown) => Bluebird<void>

function setup(adb?: ReturnType<typeof maestroAdb>) {
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
  , adb
  ) as GroupPlugin
  return {plugin: plugin, handlers: handlers, push: push}
}

function maestroAdb() {
  const packages = new Set<string>()
  let failCleanup = false
  const commands: string[] = []
  return {commands, packages, setFailCleanup(value: boolean) {
    failCleanup = value
  }
  , shell(_serial: string, command: string) {
      const body = command.split('; status=$?;')[0]!
      commands.push(body)
      let output = ''
      if (body === 'pm list packages') {
        output = [...packages].map(name => 'package:' + name).join('\n')
      }
      if (body.startsWith('settings get ')) {
        output = '0'
      }
      if (body === 'ps -A' && failCleanup) {
        output = 'u0_a123 123 1 S dev.mobile.maestro'
      }
      if (body.startsWith('pm uninstall ')) {
        packages.delete(body.slice('pm uninstall '.length))
        output = 'Success'
      }
      return Bluebird.resolve(Readable.from([Buffer.from(output + '\n__STF_EXIT__0\n')]))
    }
  , util: {readAll(stream: Readable) {
      return Bluebird.resolve((async() => {
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk))
        }
        return Buffer.concat(chunks)
      })())
    }}
  }
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
})

describe('Device group Maestro cleanup fence', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
  })
  afterEach(function() {
    sinon.restore()
  })

  it('captures the baseline before the ownership ACK and refuses a simultaneous capture',
    async function() {
    const adb = maestroAdb()
    const context = setup(adb)
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const capture = context.plugin.join(owner, 10000, 'automation', undefined, 'lease-a', 'maestro')
    let blocked = false
    try {
      await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-b', 'maestro')
    }
    catch {
      blocked = true
    }
    expect(blocked).to.equal(true)
    await capture
    expect(adb.commands.filter(command => command.startsWith('settings get '))).to.have.length(6)
    const joined = messages(context.push, wire.JoinGroupMessage.$code)
    expect(joined).to.have.length(1)
    expect(wire.JoinGroupMessage.decode(joined[0]!.message).automationRunner).to.equal('maestro')
    await context.plugin.leave('test_cleanup')
  })

  it('rejects stale reservation and lease cleanup before touching the replacement Maestro driver',
    async function() {
    const adb = maestroAdb()
    const context = setup(adb)
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    const previous = await context.plugin.join(
      owner, 10000, 'automation', undefined, 'lease-a', 'maestro')
    await context.plugin.leave('test_cleanup')
    const replacement = await context.plugin.join(
      owner, 10000, 'automation', undefined, 'lease-b', 'maestro')
    expect(replacement.reservationId).to.not.equal(previous.reservationId)
    adb.packages.add('dev.mobile.maestro')
    adb.packages.add('dev.mobile.maestro.test')
    const commands = [...adb.commands]

    for (const action of ['renew', 'release']) {
      const reply = await transaction(context, wire.AutomationLeaseMessage,
        new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', action, 10000))
      expect(reply.success).to.equal(false)
      expect(await context.plugin.get()).to.equal(replacement)
      expect(adb.commands).to.eql(commands)
    }
    const staleRelease = await transaction(context, wire.UngroupMessage,
      new wire.UngroupMessage([], previous.reservationId))
    expect(staleRelease.success).to.equal(false)
    expect(await context.plugin.get()).to.equal(replacement)
    expect(adb.commands).to.eql(commands)
    expect([...adb.packages]).to.eql(['dev.mobile.maestro', 'dev.mobile.maestro.test'])
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)

    const renewal = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-b', 'renew', 10000))
    expect(renewal.success).to.equal(true)
    const release = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-b', 'release'))
    expect(release.success).to.equal(true)
    expect([...adb.packages]).to.eql([])
    expect(adb.commands.slice(commands.length)).to.include('am force-stop dev.mobile.maestro')
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(2)
  })

  it('retains ownership and the epoch when native cleanup fails, then permits an exact retry',
    async function() {
    const adb = maestroAdb()
    const context = setup(adb)
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-a', 'maestro')
    adb.packages.add('dev.mobile.maestro')
    adb.packages.add('dev.mobile.maestro.test')
    adb.setFailCleanup(true)
    const reservationId = (await context.plugin.get()).reservationId
    const failed = await transaction(context, wire.UngroupMessage,
      new wire.UngroupMessage([], reservationId))
    expect(failed.success).to.equal(false)
    expect((await context.plugin.get()).email).to.equal(owner.email)
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(0)
    adb.setFailCleanup(false)
    const retry = await transaction(context, wire.AutomationLeaseMessage,
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'release'))
    expect(retry.success).to.equal(true)
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)
    expect([...adb.packages]).to.eql([])
  })

  it('cleans on provider expiry without a coordinator and keeps failed cleanup fenced',
    async function() {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
    const adb = maestroAdb()
    const context = setup(adb)
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    await context.plugin.join(owner, 10, 'automation', undefined, 'lease-a', 'maestro')
    adb.setFailCleanup(true)
    await clock.tickAsync(11)
    for (let count = 0; count < 5; count++) {
      await new globalThis.Promise(resolve => setImmediate(resolve))
    }
    expect((await context.plugin.get()).email).to.equal(owner.email)
    expect(adb.commands).to.include('am force-stop dev.mobile.maestro')
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(0)
    await context.handlers[wire.AutomationLeaseMessage.$code]!('reply',
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'renew', 10000))
    const renewal = messages(context.push, wire.TransactionDoneMessage.$code)
    expect(wire.TransactionDoneMessage.decode(renewal[renewal.length - 1]!.message).success)
      .to.equal(false)
    adb.setFailCleanup(false)
    await context.handlers[wire.AutomationLeaseMessage.$code]!('reply',
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'release'))
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)
    await context.plugin.join(owner, 10000, 'automation', undefined, 'lease-b', 'maestro')
    await context.handlers[wire.AutomationLeaseMessage.$code]!('reply',
      new wire.AutomationLeaseMessage('test-device', owner, 'lease-a', 'release'))
    expect((await context.plugin.get()).email).to.equal(owner.email)
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)
    await context.plugin.leave('test_cleanup')
    clock.restore()
  })

  it('finishes native cleanup on provider expiry while the coordinator is absent',
    async function() {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
    const adb = maestroAdb()
    const context = setup(adb)
    const owner = new wire.OwnerMessage('ci@example.test', 'CI', 'ci-channel')
    await context.plugin.join(owner, 10, 'automation', undefined, 'lease-a', 'maestro')
    adb.packages.add('dev.mobile.maestro')
    adb.packages.add('dev.mobile.maestro.test')
    const left = new globalThis.Promise(resolve => context.plugin.once('leave', resolve))
    await clock.tickAsync(11)
    await left
    expect([...adb.packages]).to.eql([])
    expect(messages(context.push, wire.LeaveGroupMessage.$code)).to.have.length(1)
    let unowned = false
    try {
      await context.plugin.get()
    }
    catch {
      unowned = true
    }
    expect(unowned).to.equal(true)
    clock.restore()
  })
})
