import {EventEmitter} from 'node:events'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import lifecycle from '../../lib/util/lifecycle.js'
import wire from '../../lib/wire/index.js'
import connect from '../../lib/units/device/plugins/connect.js'

type Handler = (channel: string, message?: unknown) => void

type Key = {fingerprint: string, comment?: string}

async function setup(getGroup?: () => Bluebird<{email: string, group: string}>) {
  const bridgeOptions: {
    knownPublicKeys?: Key[]
    auth?: (key: Key) => Bluebird<void>
  } = {}
  const server = Object.assign(new EventEmitter(), {
    listen: sinon.spy(function(this: EventEmitter) {
      setImmediate(() => this.emit('listening'))
    })
  , close: sinon.spy()
  , end: sinon.spy()
  })
  const adb = {
    createTcpUsbBridge(_serial: string, options: typeof bridgeOptions) {
      Object.assign(bridgeOptions, options)
      return server
    }
  , util: {
      parsePublicKey: (key: string) => Bluebird.resolve({fingerprint: 'fp-' + key})
    }
  }
  const handlers = new Map<unknown, Handler[]>()
  const router = {
    on(type: unknown, handler: Handler) {
      handlers.set(type, [...handlers.get(type) || [], handler])
      return router
    }
  , removeListener() {
      return router
    }
  }
  const emit = (type: unknown, message?: unknown) =>
    (handlers.get(type) || []).forEach(handler => handler('channel', message))
  const push = {send: sinon.spy()}
  const group = Object.assign(new EventEmitter(), {
    get: getGroup || (() => Bluebird.resolve({email: 'alice@example.com', group: 'alice-group'}))
  , keepalive: sinon.spy()
  })
  const solo = {channel: 'solo'}
  await (connect as any).invoke(
    {serial: 'emulator-5554', connectPort: 7401, connectUrlPattern: '${publicIp}:${publicPort}'}
  , adb, router, push, group, solo, () => '127.0.0.1:7401'
  )
  return {bridgeOptions, emit, push, group}
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 1000
  while (!condition() && Date.now() < deadline) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

describe('Device connect plugin known keys', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
    sinon.stub(lifecycle, 'share')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('forgets only the key that was removed', async function() {
    const {bridgeOptions, emit, push} = await setup()
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', ['k1', 'k2']))
    await until(() => push.send.callCount >= 2)

    const known = bridgeOptions.knownPublicKeys!
    expect(known.map(key => key.fingerprint)).to.deep.equal(['fp-k1', 'fp-k2'])

    // A key was added somewhere: nothing to forget
    emit(wire.AdbKeysUpdatedMessage, new wire.AdbKeysUpdatedMessage())
    expect(known.map(key => key.fingerprint)).to.deep.equal(['fp-k1', 'fp-k2'])

    emit(wire.AdbKeysUpdatedMessage, new wire.AdbKeysUpdatedMessage({removedFingerprint: 'fp-k1'}))

    // Changed in place: the bridge holds on to this very array
    expect(bridgeOptions.knownPublicKeys).to.equal(known)
    expect(known.map(key => key.fingerprint)).to.deep.equal(['fp-k2'])

    emit(wire.AdbKeysUpdatedMessage, new wire.AdbKeysUpdatedMessage({removedFingerprint: 'other'}))
    expect(known.map(key => key.fingerprint)).to.deep.equal(['fp-k2'])
  })
})

describe('Device connect plugin removed keys', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
    sinon.stub(lifecycle, 'share')
    sinon.stub(console, 'warn')
  })

  afterEach(function() {
    sinon.restore()
  })

  function removed(fingerprint: string) {
    return new wire.AdbKeysUpdatedMessage({removedFingerprint: fingerprint})
  }

  it('keeps out a key removed while an older ConnectStart was handled', async function() {
    let releaseGroup!: () => void
    const groupReady = new Bluebird<void>(resolve => {
      releaseGroup = resolve
    })
    const {bridgeOptions, emit, push} = await setup(() =>
      groupReady.then(() => ({email: 'alice@example.com', group: 'alice-group'})))

    // The key list was read before the removal, the removal arrives while it's being handled
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', ['k1', 'k2']))
    emit(wire.AdbKeysUpdatedMessage, removed('fp-k1'))
    releaseGroup()
    await until(() => push.send.callCount >= 2)

    expect(bridgeOptions.knownPublicKeys!.map(key => key.fingerprint)).to.deep.equal(['fp-k2'])
  })

  it('lets a join that was under way in without caching the removed key', async function() {
    const {bridgeOptions, emit, push, group} = await setup()
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', []))
    await until(() => push.send.callCount >= 2)

    const joined = bridgeOptions.auth!({fingerprint: 'fp-k3', comment: 'alice@host'})
    emit(wire.AdbKeysUpdatedMessage, removed('fp-k3'))
    // The processor looked the key up before it was removed
    group.emit('autojoin', 'fp-k3', true)
    await joined

    expect(bridgeOptions.knownPublicKeys).to.deep.equal([])
  })

  it('forgets removed keys when the owner leaves', async function() {
    const {bridgeOptions, emit, push, group} = await setup()
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', ['k1']))
    await until(() => push.send.callCount >= 2)
    emit(wire.AdbKeysUpdatedMessage, removed('fp-k1'))

    group.emit('leave')
    await until(() => bridgeOptions.knownPublicKeys!.length === 0)
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', ['k1']))
    await until(() => bridgeOptions.knownPublicKeys!.length > 0)

    expect(bridgeOptions.knownPublicKeys!.map(key => key.fingerprint)).to.deep.equal(['fp-k1'])
  })

  it('asks again for a waiting key when a key was added, not removed', async function() {
    const {bridgeOptions, emit, push, group} = await setup()
    emit(wire.ConnectStartMessage, new wire.ConnectStartMessage('alice@example.com', []))
    await until(() => push.send.callCount >= 2)

    const joins = () => push.send.getCalls().filter(call => call.args[0][0] === 'solo').length
    bridgeOptions.auth!({fingerprint: 'fp-k4', comment: 'alice@host'}).catch(() => {})
    await until(() => joins() === 1)

    emit(wire.AdbKeysUpdatedMessage, removed('fp-other'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(joins()).to.equal(1)

    emit(wire.AdbKeysUpdatedMessage, new wire.AdbKeysUpdatedMessage())
    await until(() => joins() === 2)
    expect(joins()).to.equal(2)
    // Settles the waiting connection, so its timeout doesn't outlive the test
    group.emit('autojoin', 'fp-k4', false)
  })
})
