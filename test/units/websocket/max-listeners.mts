import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import http from 'node:http'
import sinon from 'sinon'
import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'
import wirerouter from '../../../lib/wire/router.js'
import type {WebsocketOptions} from '../../../lib/types/units-websocket.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

type Listener = (...args: any[]) => void

interface MockSocket {
  request: {
    user: {
      email: string
      name: string
      group: string
      privilege: string
      groups: {
        subscribed: string[]
      }
    }
    ip: string
  }
  handshake: {
    query: Record<string, string>
  }
  use(callback: (...args: any[]) => void): void
  emit(event: string, ...args: any[]): void
  on(event: string, callback: Listener): MockSocket
  disconnect(): void
  listeners: Map<string, Listener>
  close(): Promise<void>
}

describe('websocket subscription cleanup and max listeners (Issue #162)', function() {
  let connect: (socket: unknown) => void
    , websocket: (options: WebsocketOptions) => {
        server: http.Server
        io: unknown
        channelRouter: EventEmitter
      }
    , subSocket: EventEmitter & {
        subscribe: ReturnType<typeof sinon.spy>
        unsubscribe: ReturnType<typeof sinon.spy>
        send: ReturnType<typeof sinon.spy>
        close: ReturnType<typeof sinon.spy>
      }

  class FakeSocketServer {
    use() {}
    on(event: string, callback: typeof connect) {
      if (event === 'connection') {
        connect = callback
      }
    }
  }

  before(async function() {
    const restoreIo = mockModule(new URL(import.meta.resolve('socket.io')), {
      Server: FakeSocketServer
    })
    const restoreZmq = mockModule(new URL('../../../lib/util/zmqutil.js', import.meta.url), {
      default: {
        socket(type: string) {
          const transport = Object.assign(new EventEmitter(), {
            subscribe: sinon.spy()
          , unsubscribe: sinon.spy()
          , send: sinon.spy()
          , close: sinon.spy()
          })
          if (type === 'sub') {
            subSocket = transport
          }
          return transport
        }
      }
    })
    const restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
      default: {
        loadDeviceByChannel: async() => null
      , loadDeviceBySerial: async() => null
      }
    })
    const restoreAdb = mockModule(new URL('../../../lib/util/adbutil.js', import.meta.url), {
      default: () => ({
        util: {
          parsePublicKey: () => ({fingerprint: 'dummy'})
        }
      })
    })
    const restoreLifecycle = mockModule(
      new URL('../../../lib/util/lifecycle.js', import.meta.url)
    , {
        default: {
          observe() {}
        }
      }
    )

    try {
      websocket = (await importFresh(new URL('../../../lib/units/websocket/index.js',
        import.meta.url))).default
    }
    finally {
      restoreLifecycle()
      restoreAdb()
      restoreDb()
      restoreZmq()
      restoreIo()
    }
  })

  function createMockSocket(userGroup = 'private-group'): MockSocket {
    const listeners = new Map<string, Listener>()
    const socket: MockSocket = {
      request: {
        user: {
          email: 'user@example.test'
        , name: 'User'
        , group: userGroup
        , privilege: 'user'
        , groups: {
            subscribed: [userGroup]
          }
        }
      , ip: '127.0.0.1'
      }
    , handshake: {
        query: {}
      }
    , use() {}
    , emit() {}
    , on(event: string, callback: Listener) {
        listeners.set(event, callback)
        return socket
      }
    , disconnect() {}
    , listeners
    , async close() {
        const onDisconnect = listeners.get('disconnect')
        if (onDisconnect) {
          onDisconnect()
        }
        await new Promise<void>(function(resolve) {
          setImmediate(resolve)
        })
      }
    }

    connect(socket)
    return socket
  }

  it('should not emit MaxListenersExceededWarning with >10 clients on *ALL', async function() {
    const warnings: Error[] = []
    function onWarning(warning: Error) {
      warnings.push(warning)
    }
    process.on('warning', onWarning)

    const serverStub = sinon.stub(http, 'createServer').returns({
      listen() {}
    } as unknown as http.Server)

    let unit: ReturnType<typeof websocket> | undefined
    try {
      unit = websocket({
        port: 0
      , secret: 'test-secret'
      , ssid: 'test-ssid'
      , storageUrl: 'http://storage.test'
      , endpoints: {
          push: []
        , sub: []
        }
      })

      const clientCount = 15
      const clients: MockSocket[] = []

      for (let i = 0; i < clientCount; i++) {
        clients.push(createMockSocket(`group-${i}`))
      }

      assert.equal(unit.channelRouter.listenerCount(wireutil.global), clientCount)
      assert.equal(
        warnings.filter(w => w.name === 'MaxListenersExceededWarning').length
      , 0
      , 'No MaxListenersExceededWarning should be emitted for >10 concurrent connections'
      )

      for (const client of clients) {
        await client.close()
      }

      assert.equal(
        unit.channelRouter.listenerCount(wireutil.global)
      , 0
      , 'All *ALL listeners should be cleaned up on disconnect'
      )
    }
    finally {
      process.removeListener('warning', onWarning)
      serverStub.restore()
    }
  })

  it('should prevent listener leak on duplicate joinChannel/tx.punch', async function() {
    const serverStub = sinon.stub(http, 'createServer').returns({
      listen() {}
    } as unknown as http.Server)

    let unit: ReturnType<typeof websocket> | undefined
    try {
      unit = websocket({
        port: 0
      , secret: 'test-secret'
      , ssid: 'test-ssid'
      , storageUrl: 'http://storage.test'
      , endpoints: {
          push: []
        , sub: []
        }
      })

      const client = createMockSocket('group-test')
      const punchHandler = client.listeners.get('tx.punch')
      const cleanupHandler = client.listeners.get('tx.cleanup')

      assert.ok(punchHandler, 'tx.punch listener should be registered')
      assert.ok(cleanupHandler, 'tx.cleanup listener should be registered')

      // Punch channel twice
      punchHandler('dynamic-chan')
      punchHandler('dynamic-chan')

      assert.equal(
        unit.channelRouter.listenerCount('dynamic-chan')
      , 1
      , 'Deduplication should ensure only 1 listener is registered on channelRouter'
      )

      // Clean up once
      cleanupHandler('dynamic-chan')

      assert.equal(
        unit.channelRouter.listenerCount('dynamic-chan')
      , 0
      , 'Cleaning up the channel removes the listener completely'
      )

      // Client closes
      await client.close()
      assert.equal(unit.channelRouter.listenerCount('group-test'), 0)
      assert.equal(unit.channelRouter.listenerCount(wireutil.global), 0)
    }
    finally {
      serverStub.restore()
    }
  })

  it('should keep shared subscriptions until all clients disconnect', async function() {
    const serverStub = sinon.stub(http, 'createServer').returns({
      listen() {}
    } as unknown as http.Server)

    let unit: ReturnType<typeof websocket> | undefined
    try {
      unit = websocket({
        port: 0
      , secret: 'test-secret'
      , ssid: 'test-ssid'
      , storageUrl: 'http://storage.test'
      , endpoints: {
          push: []
        , sub: []
        }
      })

      subSocket.unsubscribe.resetHistory()
      subSocket.subscribe.resetHistory()

      // Two clients in the same user group
      const client1 = createMockSocket('shared-group')
      const client2 = createMockSocket('shared-group')

      assert.equal(unit.channelRouter.listenerCount('shared-group'), 2)
      assert.equal(
        subSocket.subscribe.withArgs('shared-group').callCount
      , 1
      , 'sub.subscribe should only be called once when the first client joins'
      )

      // Client 1 disconnects
      await client1.close()

      assert.equal(unit.channelRouter.listenerCount('shared-group'), 1)
      assert.ok(
        !subSocket.unsubscribe.calledWith('shared-group')
      , 'sub.unsubscribe should NOT be called while client2 is still subscribed'
      )

      // Client 2 disconnects
      await client2.close()

      assert.equal(unit.channelRouter.listenerCount('shared-group'), 0)
      assert.ok(
        subSocket.unsubscribe.calledWith('shared-group')
      , 'sub.unsubscribe should be called once the last client disconnects'
      )

      // Ensure *ALL was never unsubscribed
      assert.ok(
        !subSocket.unsubscribe.calledWith(wireutil.global)
      , 'sub.unsubscribe should never unsubscribe the permanent *ALL channel'
      )
    }
    finally {
      serverStub.restore()
    }
  })

  it('WireRouter (eventemitter3) supports >10 handlers without warning', function() {
    const warnings: Error[] = []
    function onWarning(warning: Error) {
      warnings.push(warning)
    }
    process.on('warning', onWarning)

    try {
      const router = wirerouter()
      const handlers: Array<() => void> = []

      for (let i = 0; i < 20; i++) {
        const handler = sinon.spy()
        handlers.push(handler)
        router.on(wire.DeviceChangeMessage, handler)
      }

      assert.equal(
        warnings.filter(w => w.name === 'MaxListenersExceededWarning').length
      , 0
      , 'WireRouter (eventemitter3) should not warn for >10 listeners'
      )

      for (const handler of handlers) {
        router.removeListener(wire.DeviceChangeMessage, handler)
      }
    }
    finally {
      process.removeListener('warning', onWarning)
    }
  })
})
