import {EventEmitter} from 'node:events'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import lifecycle from '../../lib/util/lifecycle.js'
import wire from '../../lib/wire/index.js'
import connect from '../../lib/units/device/plugins/connect.js'

type Handler = (channel: string, message?: unknown) => void

async function setup() {
  const bridgeOptions: {knownPublicKeys?: {fingerprint: string}[]} = {}
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
    get: () => Bluebird.resolve({email: 'alice@example.com', group: 'alice-group'})
  , keepalive: sinon.spy()
  })
  const solo = {channel: 'solo'}
  await (connect as any).invoke(
    {serial: 'emulator-5554', connectPort: 7401, connectUrlPattern: '${publicIp}:${publicPort}'}
  , adb, router, push, group, solo, () => '127.0.0.1:7401'
  )
  return {bridgeOptions, emit, push}
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
