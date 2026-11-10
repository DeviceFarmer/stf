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
const restoreDb = mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {}})
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
    request: {user: {email: 'admin@example.test', name: 'Admin', group: 'admin-private'
      , privilege: 'admin', groups: {subscribed: ['visible-group']}}, ip: '127.0.0.1'}
    , handshake: {query: {}}
    , use() {}
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
