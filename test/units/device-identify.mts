import {PassThrough} from 'node:stream'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import protobuf from '../../lib/wire/protobuf.js'
import pathutil from '../../lib/util/pathutil.js'
import devutil from '../../lib/util/devutil.js'
import lifecycle from '../../lib/util/lifecycle.js'
import wire from '../../lib/wire/index.js'
import service from '../../lib/units/device/plugins/service.js'
import type {ServicePlugin} from '../../lib/types/device-plugins.js'

const builder = protobuf.load(pathutil.module(
  '@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto'))
const proto = (protobuf.build(builder) as any).jp.co.cyberagent.stf.proto

type Handler = (channel: string, message?: unknown) => void

function endedStream() {
  const out = new PassThrough()
  out.end()
  return out
}

async function setup() {
  sinon.stub(devutil, 'killProcsByComm').callsFake(() => Bluebird.resolve())
  sinon.stub(devutil, 'ensureUnusedLocalSocket').callsFake(
    (_adb, _serial, sock) => Bluebird.resolve(sock))
  sinon.stub(devutil, 'waitForLocalSocket').callsFake(
    () => Bluebird.resolve(new PassThrough() as any))
  const adb = {shell: sinon.stub().callsFake(() => Bluebird.resolve(endedStream()))}
  const handlers = new Map<unknown, Handler>()
  const router = {
    on(type: unknown, handler: Handler) {
      handlers.set(type, handler)
      return router
    }
  }
  const push = {send: sinon.spy()}
  const apk = {
    path: '/data/app/stf.apk'
  , main: 'jp.co.cyberagent.stf.Agent'
  , wire: proto
  , startIntent: {action: 'jp.co.cyberagent.stf.ACTION_START'
    , component: 'jp.co.cyberagent.stf/.Service'}
  }
  const plugin = await (service as any).invoke(
    {serial: 'emulator-5554'}, adb, router, push, {level: 30}, apk
  ) as ServicePlugin
  const identify = handlers.get(wire.PhysicalIdentifyMessage)
  expect(identify, 'PhysicalIdentifyMessage handler').to.be.a('function')
  return {plugin, push, identify: identify!}
}

function sentReplies(push: {send: sinon.SinonSpy}) {
  return push.send.getCalls().map(call => {
    const [channel, data] = call.args[0] as [string, Buffer]
    const envelope = wire.Envelope.decode(data)
    expect(envelope.type).to.equal(wire.MessageType.TransactionDoneMessage)
    return {channel, done: wire.TransactionDoneMessage.decode(envelope.message)}
  })
}

// Waits until the handler has pushed `count` replies (or fails after 1 s)
async function untilReplies(push: {send: sinon.SinonSpy}, count = 1) {
  const deadline = Date.now() + 1000
  while (push.send.callCount < count && Date.now() < deadline) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

describe('Device service plugin identify', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
    sinon.stub(lifecycle, 'fatal')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('replies okay only after the identify screen was shown', async function() {
    const {plugin, push, identify} = await setup()
    let finish!: () => void
    sinon.stub(plugin, 'identity').callsFake(() => new Bluebird<void>(resolve => {
      finish = resolve
    }))

    identify('tx-channel')
    // Let a full event-loop turn pass so a premature reply would be visible
    await new Promise(resolve => setImmediate(resolve))
    expect(push.send.called).to.equal(false, 'No reply before the service answers')

    finish()
    await untilReplies(push)
    const replies = sentReplies(push)
    expect(replies).to.have.length(1)
    expect(replies[0]!.channel).to.equal('tx-channel')
    expect(replies[0]!.done.success).to.equal(true)
    expect(replies[0]!.done.source).to.equal('emulator-5554')
  })

  it('replies fail when the service reports failure', async function() {
    const {plugin, push, identify} = await setup()
    sinon.stub(plugin, 'identity').callsFake(
      () => Bluebird.reject(new Error('Unable to identify device')))

    identify('tx-channel')
    await untilReplies(push)
    const replies = sentReplies(push)
    expect(replies).to.have.length(1)
    expect(replies[0]!.channel).to.equal('tx-channel')
    expect(replies[0]!.done.success).to.equal(false)
    expect(replies[0]!.done.data).to.equal('Unable to identify device')
  })

  it('replies fail when the service does not answer in time', async function() {
    const {plugin, push, identify} = await setup()
    sinon.stub(plugin, 'identity').callsFake(
      () => Bluebird.reject(new Bluebird.TimeoutError('operation timed out')))

    identify('tx-channel')
    await untilReplies(push)
    const replies = sentReplies(push)
    expect(replies).to.have.length(1)
    expect(replies[0]!.done.success).to.equal(false)
    expect(replies[0]!.done.data).to.equal('operation timed out')
  })

  it('replies fail when the service rejects with a non-Error value', async function() {
    const {plugin, push, identify} = await setup()
    sinon.stub(plugin, 'identity').callsFake(() => Bluebird.reject('boom' as any))

    identify('tx-channel')
    await untilReplies(push)
    const replies = sentReplies(push)
    expect(replies).to.have.length(1)
    expect(replies[0]!.done.success).to.equal(false)
    expect(replies[0]!.done.data).to.equal('boom')
  })

  it('replies fail when the service rejects with undefined', async function() {
    const {plugin, push, identify} = await setup()
    sinon.stub(plugin, 'identity').callsFake(() => Bluebird.reject())

    identify('tx-channel')
    await untilReplies(push)
    const replies = sentReplies(push)
    expect(replies).to.have.length(1)
    expect(replies[0]!.done.success).to.equal(false)
  })
})
