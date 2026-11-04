import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import http from 'node:http'
import sinon from 'sinon'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import type {WebsocketOptions} from '../../lib/types/units-websocket.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

let connect: (socket: unknown) => void, websocket: (options: WebsocketOptions) => void
 , device: any; let failLoad = false
const transports: Array<EventEmitter & {send: ReturnType<typeof sinon.spy>}> = []
class FakeSocketServer {
  use() {}
  on(event: string, callback: typeof connect) {
    if (event === 'connection') {
      connect = callback
    }
  }
}
const restoreIo = mockModule(new URL(import.meta.resolve('socket.io')), {
  Server: FakeSocketServer
})
const restoreZmq = mockModule(new URL('../../lib/util/zmqutil.js', import.meta.url), {
  default: {socket() {
    const transport = Object.assign(new EventEmitter(), {
      subscribe() {}, unsubscribe() {}, send: sinon.spy(), close() {}
    })
    transports.push(transport)
    return transport
  }}
})
const restoreDb = mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {
  loadDeviceByChannel: async() => structuredClone(device)
  , loadDeviceBySerial: async() => {
    if (failLoad) {
      throw new Error('Unavailable')
    }
    return structuredClone(device)
  }
}})
const restoreAdb = mockModule(new URL('../../lib/util/adbutil.js', import.meta.url), {
  default: () => ({})
})
const restoreLifecycle = mockModule(new URL('../../lib/util/lifecycle.js', import.meta.url), {
  default: {observe() {}}
})
try {
  websocket = (await importFresh(new URL('../../lib/units/websocket/index.js',
    import.meta.url))).default
}
finally {
  restoreLifecycle()
  restoreAdb()
  restoreDb()
  restoreZmq()
  restoreIo()
}

type Listener = (...args: any[]) => void
function fixture() {
  device = {serial: 'PHONE', channel: 'runtime', present: true, ready: true
    , group: {id: 'shared'}, usage: null
    , owner: {email: 'owner@example.test', name: 'Owner', group: 'private', reservationId: 'first'}}
  transports.length = 0
  failLoad = false
  const server = sinon.stub(http, 'createServer').returns({listen() {}} as unknown as http.Server)
  try {
    websocket({port: 0, secret: 'test-secret', ssid: 'test-ssid'
      , storageUrl: 'http://storage.test', endpoints: {push: [], sub: []}})
  }
  finally {
    server.restore()
  }
  const listeners = new Map<string, Listener>()
  let guard: (packet: readonly unknown[], next: (error?: Error) => void) => void
  const socket = {
    request: {user: {email: 'owner@example.test', name: 'Owner', group: 'private'
      , privilege: 'user', groups: {subscribed: ['shared']}}, ip: '127.0.0.1'}
    , handshake: {query: {}}
    , use(callback: typeof guard) {
      guard = callback
    }
    , emit() {}
    , on(event: string, callback: Listener) {
      listeners.set(event, callback)
      return socket
    }
    , disconnect() {}
  }
  connect(socket)
  return {
    dispatch(event: string, data: object, defer = false): Promise<() => void> {
      return new Promise((resolve, reject) => guard([event, device.channel, data], error => {
        if (error) {
          reject(error)
          return
        }
        const deliver = () => listeners.get(event)!(device.channel, data)
        if (!defer) {
          deliver()
        }
        resolve(deliver)
      }))
    }
    , owner(reservationId: string) {
      device = {...device, owner: {...device.owner, reservationId}}
      transports[1]!.emit('message', Buffer.from(wireutil.global), wireutil.envelope(
        new wire.JoinGroupMessage(device.serial, device.owner)
      ))
    }
    , failLoad: () => {
      failLoad = true
    }
    , envelopes: (): ReturnType<typeof wire.Envelope.decode>[] =>
      transports[0]!.send.getCalls().map((call: {args: any[]}) =>
        wire.Envelope.decode(call.args[0][1]))
    , async close() {
      listeners.get('disconnect')!()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
}

describe('server generated touch identity', function() {
  it('stamps every touch packet from authorization and distinguishes cancel from sequenced reset',
    async function() {
    const f = fixture()
    try {
      const before = Date.now()
      await f.dispatch('input.gestureStart', {seq: 0, gestureId: 'spoof', reservationId: 'victim'})
      const types = [wire.GestureStartMessage, wire.TouchDownMessage, wire.TouchMoveMessage
        , wire.TouchCommitMessage, wire.TouchResetMessage, wire.TouchUpMessage
        , wire.GestureStopMessage]
      for (const [index, event] of ['input.touchDown', 'input.touchMove', 'input.touchCommit'
        , 'input.touchReset', 'input.touchUp', 'input.gestureStop'].entries()) {
        await f.dispatch(event, {seq: index + 1, contact: 0, x: 0.5, y: 0.5
          , gestureId: 'spoof', reservationId: 'victim', cancel: true, cancelThrough: true})
      }
      const packets = f.envelopes().map((envelope, index) => types[index]!.decode(envelope.message))
      const gestureId = packets[0]!.gestureId
      assert.match(gestureId!, /^[a-f0-9-]{36}:1:[0-9]+$/)
      const issuedAt = Number(gestureId!.split(':')[2])
      assert.ok(issuedAt >= before && issuedAt <= Date.now())
      for (const packet of packets) {
        assert.equal(packet.gestureId, gestureId)
        assert.equal(packet.reservationId, 'first')
      }
      assert.equal((packets[4] as any).cancel, false)
      assert.notEqual((packets[4] as any).cancelThrough, true)
      await f.dispatch('input.gestureStart', {seq: 7})
      await f.close()
      const reset = wire.TouchResetMessage.decode(f.envelopes().at(-1)!.message)
      assert.equal(reset.cancel, true)
      assert.equal(reset.reservationId, 'first')
      assert.equal(reset.gestureId!.split(':')[0], gestureId!.split(':')[0])
      assert.equal(reset.gestureId!.split(':')[1], '2')
      assert.ok(Number(reset.gestureId!.split(':')[2]) >= issuedAt)
    }
    finally {
      await f.close()
    }
  })

  it('keeps the current gesture when an older Start is dispatched late', async function() {
    const f = fixture()
    try {
      const first = await f.dispatch('input.gestureStart', {seq: 0}, true)
      const second = await f.dispatch('input.gestureStart', {seq: 6}, true)
      second()
      first()
      assert.equal(f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code).length, 0)
      await f.close()
      const starts = f.envelopes()
        .filter(envelope => envelope.type === wire.GestureStartMessage.$code)
        .map(envelope => wire.GestureStartMessage.decode(envelope.message))
      const resets = f.envelopes()
        .filter(envelope => envelope.type === wire.TouchResetMessage.$code)
        .map(envelope => wire.TouchResetMessage.decode(envelope.message))
      assert.equal(starts.length, 2)
      assert.equal(resets.length, 1, 'One fence cancels the unfinished source chain atomically')
      assert.equal(resets[0]!.gestureId, starts[0]!.gestureId)
      assert.equal(resets[0]!.cancelThrough, true)
      assert.equal(starts[0]!.gestureId!.split(':')[1], '2')
    }
    finally {
      await f.close()
    }
  })

  it('preserves the previous tail when its Stop dispatch is delayed past the next Start',
    async function() {
    const f = fixture()
    try {
      await f.dispatch('input.gestureStart', {seq: 0})
      await f.dispatch('input.touchDown', {seq: 1, contact: 0, x: 0.5, y: 0.5})
      const up = await f.dispatch('input.touchUp', {seq: 2, contact: 0}, true)
      const stop = await f.dispatch('input.gestureStop', {seq: 3}, true)
      await f.dispatch('input.gestureStart', {seq: 4})
      assert.equal(f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code).length, 0)
      up()
      stop()
      await f.close()
      const resets = f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code)
      assert.equal(resets.length, 1)
      const reset = wire.TouchResetMessage.decode(resets[0]!.message)
      assert.equal(reset.gestureId!.split(':')[1], '2')
    }
    finally {
      await f.close()
    }
  })

  it('retains the highest cleanup fence after the newer Stop dispatches', async function() {
    const f = fixture()
    try {
      await f.dispatch('input.gestureStart', {seq: 0})
      await f.dispatch('input.gestureStop', {seq: 3}, true)
      await f.dispatch('input.gestureStart', {seq: 4})
      await f.dispatch('input.gestureStop', {seq: 7})
      await f.close()
      const resets = f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code)
      assert.equal(resets.length, 1)
      assert.equal(wire.TouchResetMessage.decode(resets[0]!.message)
        .gestureId!.split(':')[1], '2')
    }
    finally {
      await f.close()
    }
  })

  it('retains the source fence when every Stop has already been sent to the provider',
    async function() {
    const f = fixture()
    try {
      await f.dispatch('input.gestureStart', {seq: 0})
      await f.dispatch('input.gestureStop', {seq: 3})
      await f.dispatch('input.gestureStart', {seq: 4})
      await f.dispatch('input.gestureStop', {seq: 7})
      await f.close()
      const resets = f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code)
      assert.equal(resets.length, 1)
      const reset = wire.TouchResetMessage.decode(resets[0]!.message)
      assert.equal(reset.gestureId!.split(':')[1], '2')
      assert.equal(reset.cancelThrough, true)
    }
    finally {
      await f.close()
    }
  })

  it('cancels all unfinished gestures in the denied reservation', async function() {
    const f = fixture()
    try {
      await f.dispatch('input.gestureStart', {seq: 0})
      await f.dispatch('input.gestureStart', {seq: 4})
      f.failLoad()
      await new Promise(resolve => setTimeout(resolve, 110))
      await assert.rejects(f.dispatch('input.touchMove', {seq: 5, contact: 0, x: 0.5, y: 0.4}))
      await f.close()
      const resets = f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code)
        .map(envelope => wire.TouchResetMessage.decode(envelope.message))
      assert.equal(resets.length, 1)
      assert.equal(resets[0]!.gestureId!.split(':')[1], '2')
      assert.equal(resets[0]!.reservationId, 'first')
      assert.equal(resets[0]!.cancel, true)
      assert.equal(resets[0]!.cancelThrough, true)
    }
    finally {
      await f.close()
    }
  })

  it('bounds reservation cleanup contexts and cancels the oldest when full', async function() {
    const f = fixture()
    try {
      for (let count = 0; count < 129; count++) {
        f.owner('context-' + count)
        await f.dispatch('input.gestureStart', {seq: count % 100})
      }
      const resets = () => f.envelopes().filter(envelope =>
        envelope.type === wire.TouchResetMessage.$code)
        .map(envelope => wire.TouchResetMessage.decode(envelope.message))
      assert.equal(resets().length, 1)
      assert.equal(resets()[0]!.gestureId!.split(':')[1], '1')
      assert.equal(resets()[0]!.cancelThrough, true)
      assert.equal(resets()[0]!.reservationId, 'context-0')
      await f.close()
      assert.equal(resets().length, 129)
      assert.equal(new Set(resets().map(reset => reset.gestureId)).size, 129)
      assert.equal(resets().at(-1)!.gestureId!.split(':')[1], '129')
    }
    finally {
      await f.close()
    }
  })

  it('cancels approved input before deferred Socket.IO dispatch', async function() {
    const f = fixture()
    try {
      const start = await f.dispatch('input.gestureStart', {seq: 0}, true)
      const down = await f.dispatch('input.touchDown', {seq: 1, contact: 0, x: 0.5, y: 0.5}, true)
      f.failLoad()
      await new Promise(resolve => setTimeout(resolve, 110))
      await assert.rejects(f.dispatch('input.touchMove', {seq: 2, contact: 0, x: 0.5, y: 0.4}))
      const cancellation = f.envelopes()[0]!
      assert.equal(cancellation.type, wire.TouchResetMessage.$code)
      const reset = wire.TouchResetMessage.decode(cancellation.message)
      start()
      down()
      const started = wire.GestureStartMessage.decode(f.envelopes()[1]!.message)
      assert.equal(reset.gestureId, started.gestureId)
      assert.equal(reset.reservationId, started.reservationId)
      assert.equal(reset.cancel, true)
    }
    finally {
      await f.close()
    }
  })

  it('keeps each pending packet bound to its own authorization snapshot', async function() {
    const f = fixture()
    try {
      const first = await f.dispatch('input.gestureStart', {seq: 0}, true)
      f.owner('replacement')
      const second = await f.dispatch('input.gestureStart', {seq: 0}, true)
      first()
      second()
      const starts = f.envelopes()
        .filter(envelope => envelope.type === wire.GestureStartMessage.$code)
        .map(envelope => wire.GestureStartMessage.decode(envelope.message))
      assert.equal(starts[0]!.reservationId, 'first')
      assert.equal(starts[1]!.reservationId, 'replacement')
      assert.notEqual(starts[0]!.gestureId, starts[1]!.gestureId)
      await f.close()
      const resets = f.envelopes()
        .filter(envelope => envelope.type === wire.TouchResetMessage.$code)
        .map(envelope => wire.TouchResetMessage.decode(envelope.message))
      assert.equal(resets.length, 2)
      assert.deepEqual(new Set(resets.map(reset => reset.reservationId)),
        new Set(['first', 'replacement']))
      assert.ok(resets.every(reset => reset.cancelThrough === true))
    }
    finally {
      await f.close()
    }
  })

  it('retains current cleanup after dispatching an old touch and stop', async function() {
    const f = fixture()
    try {
      await f.dispatch('input.gestureStart', {seq: 0})
      const down = await f.dispatch('input.touchDown', {
        seq: 1, contact: 0, x: 0.5, y: 0.5
      }, true)
      const stop = await f.dispatch('input.gestureStop', {seq: 5}, true)
      await f.dispatch('input.gestureStart', {seq: 6})
      down()
      stop()
      await f.close()

      const envelopes = f.envelopes()
      const starts = envelopes
        .filter(envelope => envelope.type === wire.GestureStartMessage.$code)
        .map(envelope => wire.GestureStartMessage.decode(envelope.message))
      assert.equal(starts.length, 2)
      for (const type of [wire.TouchDownMessage, wire.GestureStopMessage]) {
        const envelope = envelopes.find(item => item.type === type.$code)!
        const packet = type.decode(envelope.message)
        assert.equal(packet.gestureId, starts[0]!.gestureId)
        assert.equal(packet.reservationId, starts[0]!.reservationId)
      }
      const reset = wire.TouchResetMessage.decode(envelopes.at(-1)!.message)
      assert.equal(envelopes.at(-1)!.type, wire.TouchResetMessage.$code)
      assert.equal(reset.gestureId, starts[1]!.gestureId)
      assert.equal(reset.reservationId, starts[1]!.reservationId)
      assert.equal(reset.cancel, true)
    }
    finally {
      await f.close()
    }
  })
})
