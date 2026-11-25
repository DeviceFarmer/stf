import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import http from 'node:http'
import sinon from 'sinon'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import type {WebsocketOptions} from '../../lib/types/units-websocket.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

let connect: (socket: unknown) => void, websocket: (options: WebsocketOptions) => void
const transports: EventEmitter[] = []
type DisconnectHandler = (value?: unknown) => void
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
      subscribe() {}, unsubscribe() {}, send() {}, close() {}
    })
    transports.push(transport)
    return transport
  }}
})
const loadDeviceBySerial = sinon.stub().resolves(null)
const restoreDb = mockModule(new URL('../../lib/db/api.js', import.meta.url), {
  default: {loadDeviceBySerial}
})
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

function socketTemplate() {
  return {
    request: {user: {email: 'admin@example.test', name: 'Admin', group: 'admin-private'
      , privilege: 'admin', groups: {subscribed: ['visible-group']}}, ip: '127.0.0.1'}
    , handshake: {query: {}}
    , use() {}
    , on() {
      return this
    }
    , disconnect() {}
  }
}

function fixture() {
  transports.length = 0
  const listen = sinon.spy()
  const server = sinon.stub(http, 'createServer').returns({listen} as unknown as http.Server)
  try {
    websocket({port: 0, secret: 'test-secret', ssid: 'test-ssid'
      , storageUrl: 'http://storage.test', endpoints: {push: [], sub: []}})
  }
  finally {
    server.restore()
  }
  const emitted: {event: string, data: any}[] = []
  const listeners = new Map<string, DisconnectHandler>()
  const socket = {
    ...socketTemplate()
    , emit(event: string, data: unknown) {
      emitted.push({event, data: JSON.parse(JSON.stringify(data))})
    }
    , on(event: string, callback: (value?: unknown) => void) {
      listeners.set(event, callback)
      return socket
    }
    , disconnect() {}
  }
  connect(socket)
  return {
    send(message: Parameters<typeof wireutil.envelope>[0]) {
      transports[1]!.emit('message', Buffer.from(wireutil.global), wireutil.envelope(message))
      return emitted.filter(item => item.event === 'device.change').at(-1)!.data.data
    }
    , changes: () => emitted.filter(item => item.event === 'device.change').length
    , lastChange: () => emitted.filter(item => item.event === 'device.change').at(-1)!.data.data
    , close: async() => {
      listeners.get('disconnect')!()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
}

const owner = {email: 'runner@example.test', name: 'Runner', group: 'runner-private'
  , reservationId: 'reservation-one'}

describe('websocket ownership events', function() {
  it('publishes and clears the coordinator fence with ownership', async function() {
    const f = fixture()
    try {
      const joined = f.send(new wire.JoinGroupMessage('device', owner, 'automation', 'lease-one'))
      assert.equal(joined.automationLeaseId, 'lease-one')
      const left = f.send(new wire.LeaveGroupMessage('device', owner, 'automation_release'))
      assert.equal(left.owner, null)
      assert.equal(left.usage, null)
      assert.equal(left.automationLeaseId, null)
      const manual = f.send(new wire.JoinGroupMessage('device', {...owner
        , reservationId: 'manual-reservation'}))
      assert.equal(manual.automationLeaseId, null)
    }
    finally {
      await f.close()
    }
  })

  it('updates the fence when the same account starts another automation', async function() {
    const f = fixture()
    try {
      f.send(new wire.JoinGroupMessage('device', owner, 'automation', 'lease-one'))
      const replacement = f.send(new wire.JoinGroupMessage('device', {...owner
        , reservationId: 'reservation-two'}, 'automation', 'lease-two'))
      assert.equal(replacement.automationLeaseId, 'lease-two')
      assert.equal(replacement.owner.reservationId, 'reservation-two')
    }
    finally {
      await f.close()
    }
  })

  it('ignores a delayed leave from the preceding reservation', async function() {
    const f = fixture()
    try {
      f.send(new wire.JoinGroupMessage('device', owner, 'automation', 'lease-one'))
      const replacement = {...owner, reservationId: 'reservation-two'}
      f.send(new wire.JoinGroupMessage('device', replacement, 'automation', 'lease-two'))
      const before = f.changes()
      const unchanged = f.send(new wire.LeaveGroupMessage('device', owner, 'automation_release'))
      assert.equal(f.changes(), before)
      assert.equal(unchanged.owner.reservationId, replacement.reservationId)
      assert.equal(unchanged.automationLeaseId, 'lease-two')
      const released = f.send(new wire.LeaveGroupMessage('device', replacement,
        'automation_release'))
      assert.equal(released.owner, null)
      assert.equal(released.automationLeaseId, null)
    }
    finally {
      await f.close()
    }
  })

  // The ready message cannot say whether the device is kept for its previous user, and without
  // that every other viewer would be offered Use until the restore lands, or for the full claim
  it('tells viewers a device that becomes ready is kept for its previous user', async function() {
    const expiresAt = Date.now() + 60000
    loadDeviceBySerial.resolves({serial: 'device', owner: null, group: {id: 'visible-group'}
      , restoreOwner: {email: 'runner@example.test', expiresAt}})
    const f = fixture()
    try {
      f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.deepEqual(f.lastChange(), {serial: 'device', claimed: true
        , claimExpiresAt: expiresAt, claimedByYou: false})

      // The restore's join ends the claim in the same write, so viewers drop it with the owner
      const joined = f.send(new wire.JoinGroupMessage('device', owner, null, null))
      assert.equal(joined.claimed, false)
      assert.equal(joined.claimExpiresAt, null)
    }
    finally {
      loadDeviceBySerial.resolves(null)
      await f.close()
    }
  })

  // The read can return after the restore's join, with the row from before it; replaying that
  // claim would show the device as kept until it expires, even once its owner has released it
  it('drops a claim read that a join overtook', async function() {
    let resolveRead!: (row: unknown) => void
    loadDeviceBySerial.returns(new Promise(resolve => {
      resolveRead = resolve
    }))
    const f = fixture()
    try {
      f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      f.send(new wire.JoinGroupMessage('device', owner, null, null))
      const before = f.changes()
      resolveRead({serial: 'device', owner: null, group: {id: 'visible-group'}
        , restoreOwner: {email: 'runner@example.test', expiresAt: Date.now() + 60000}})
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(f.changes(), before)
      assert.equal(f.lastChange().claimed, false)
    }
    finally {
      loadDeviceBySerial.reset()
      loadDeviceBySerial.resolves(null)
      await f.close()
    }
  })

  // A viewer who loaded the list while the device was away holds claimed: true; a boot that finds
  // the claim gone must clear it, or the device reads Busy until the old expiry
  it('clears a claim the viewer saw when the device comes back without one', async function() {
    loadDeviceBySerial.resolves({serial: 'device', owner: null, group: {id: 'visible-group'}
      , restoreOwner: null})
    const f = fixture()
    try {
      f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.deepEqual(f.lastChange(), {serial: 'device', claimed: false, claimExpiresAt: null
        , claimedByYou: false})
    }
    finally {
      loadDeviceBySerial.resolves(null)
      await f.close()
    }
  })

  // Per-device bookkeeping elsewhere is capped at 128 entries; a big farm's provider restart must
  // not make the claim of an early device look overtaken
  it('keeps the claim of a device while many others become ready', async function() {
    let resolveRead!: (row: unknown) => void
    loadDeviceBySerial.callsFake((serial: string) => serial === 'device' ?
      new Promise(resolve => {
        resolveRead = resolve
      }) : Promise.resolve(null))
    const f = fixture()
    try {
      f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      for (let index = 0; index < 300; index++) {
        f.send(new wire.DeviceReadyMessage(`other-${index}`, `channel-${index}`))
      }
      resolveRead({serial: 'device', owner: null, group: {id: 'visible-group'}
        , restoreOwner: {email: 'runner@example.test', expiresAt: Date.now() + 60000}})
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(f.lastChange().serial, 'device')
      assert.equal(f.lastChange().claimed, true)
    }
    finally {
      loadDeviceBySerial.reset()
      loadDeviceBySerial.resolves(null)
      await f.close()
    }
  })

  // The owner's device leaves when it goes away to reboot; it is kept for them from then on
  it('tells viewers a device that left by going away is kept for its owner', async function() {
    const expiresAt = Date.now() + 60000
    const f = fixture()
    try {
      f.send(new wire.JoinGroupMessage('device', owner, null, null))
      loadDeviceBySerial.resolves({serial: 'device', owner: null, group: {id: 'visible-group'}
        , restoreOwner: {email: owner.email, expiresAt}})
      f.send(new wire.LeaveGroupMessage('device', owner, 'device_absent', null))
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.deepEqual(f.lastChange(), {serial: 'device', claimed: true, claimExpiresAt: expiresAt
        , claimedByYou: false})
    }
    finally {
      loadDeviceBySerial.resolves(null)
      await f.close()
    }
  })

  // A provider restart makes all its devices ready at once, for every connected socket
  it('reads the row once for all sockets when a device becomes ready', async function() {
    loadDeviceBySerial.resetHistory()
    const f = fixture()
    const second = {...socketTemplate(), emit() {}}
    connect(second)
    try {
      f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(loadDeviceBySerial.callCount, 1)
    }
    finally {
      await f.close()
    }
  })

  it('clears a previous fence when the provider becomes ready again', async function() {
    const f = fixture()
    try {
      f.send(new wire.JoinGroupMessage('device', owner, 'automation', 'lease-one'))
      const ready = f.send(new wire.DeviceReadyMessage('device', 'replacement-runtime'))
      assert.equal(ready.owner, null)
      assert.equal(ready.automationLeaseId, null)
    }
    finally {
      await f.close()
    }
  })
})
