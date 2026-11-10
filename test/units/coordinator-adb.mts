import assert from 'node:assert/strict'
import net from 'node:net'
import {PassThrough} from 'node:stream'
import {once} from 'node:events'
import {LeaseAdbBridge, adbRequest, readAdbBytes} from '../../lib/units/coordinator/adb-bridge.js'

async function request(socket: net.Socket, value: string) {
  socket.write(adbRequest(value))
  return (await readAdbBytes(socket, 4)).toString()
}
async function value(socket: net.Socket) {
  const length = parseInt((await readAdbBytes(socket, 4)).toString(), 16)
  return (await readAdbBytes(socket, length)).toString()
}
async function listen(server: net.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as net.AddressInfo).port
}

async function fixture() {
  const upstreamRequests: string[] = []
  const upstreamSockets = new Set<net.Socket>()
  const upstream = net.createServer(socket => {
    upstreamSockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => upstreamSockets.delete(socket))
    ;(async() => {
      for (let index = 0; index < 2; index++) {
        const length = parseInt((await readAdbBytes(socket, 4)).toString(), 16)
        const command = (await readAdbBytes(socket, length)).toString()
        upstreamRequests.push(command)
        socket.write('OKAY')
      }
      socket.pipe(socket)
    })().catch(() => socket.destroy())
  })
  const upstreamPort = await listen(upstream)
  const bridge = new LeaseAdbBridge()
  let active = true
  const proxy = net.createServer(socket => bridge.accept(socket, {
    leaseId: 'lease-one', serial: 'PHONE-A', host: '127.0.0.1', port: upstreamPort
  }, () => {
 if (!active) {
 throw new Error('Expired lease')
}
}))
  const proxyPort = await listen(proxy)
  const sockets = new Set<net.Socket>()
  const connect = async() => {
    const socket = net.createConnection({host: '127.0.0.1', port: proxyPort})
    sockets.add(socket)
    socket.on('error', () => {})
    await once(socket, 'connect')
    return socket
  }
  return {bridge, connect, upstreamRequests, upstreamSockets, expire: () => {
 active = false
}
  , async close() {
      bridge.close()
      for (const socket of sockets) {
 socket.destroy()
}
      for (const socket of upstreamSockets) {
 socket.destroy()
}
      await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve()))
      , new Promise<void>(resolve => upstream.close(() => resolve()))])
    }}
}

describe('lease-isolated ADB smart socket', () => {
  it('exposes only the allocated serial and supports Dadb selected feature queries', async() => {
    const f = await fixture()
    try {
      const discovery = await f.connect()
      assert.equal(await request(discovery, 'host:devices'), 'OKAY')
      assert.equal(await value(discovery), 'PHONE-A\tdevice\n')
      const features = await f.connect()
      assert.equal(await request(features, 'host:transport:PHONE-A'), 'OKAY')
      assert.equal(await request(features, 'host:features'), 'OKAY')
      assert.equal(await value(features), 'cmd,shell_v2')
      assert.deepEqual(f.upstreamRequests, [])
    }
    finally {
 await f.close()
}
  })

  it('supports SDK tport but always selects the pinned upstream serial', async() => {
    const f = await fixture()
    try {
      const client = await f.connect()
      assert.equal(await request(client, 'host:tport:serial:PHONE-A'), 'OKAY')
      assert.equal((await readAdbBytes(client, 8)).readBigUInt64LE(), 1n)
      assert.equal(await request(client, 'shell,v2,TERM=dumb,raw:echo hello'), 'OKAY')
      const data = Buffer.alloc(512 * 1024, 73)
      client.write(data)
      assert.deepEqual(await readAdbBytes(client, data.length), data)
      assert.deepEqual(f.upstreamRequests,
        ['host:transport:PHONE-A', 'shell,v2,TERM=dumb,raw:echo hello'])
    }
    finally {
 await f.close()
}
  })

  it('rejects global commands, foreign serials and host bypasses after selection', async() => {
    const f = await fixture()
    try {
      for (const command of ['host:kill', 'host:connect:example:5555'
        , 'host:transport:PHONE-B', 'host:tport:serial:PHONE-B', 'host-serial:PHONE-B:features'
        , 'host:transport-any', 'shell:echo bypass', 'host:devices\n'
        , 'host:transport:PHONE-A\t']) {
        const socket = await f.connect()
        assert.equal(await request(socket, command), 'FAIL', command)
      }
      for (const command of ['host:devices', 'host:transport:PHONE-B', 'reverse:forward:tcp:1;tcp:2'
        , 'root:', 'tcp:65536', 'host:kill', 'shell,v2,raw:echo invalid\0suffix'
        , 'shell,v2,raw:echo invalid\x01suffix', 'shell,v2,\nraw:echo invalid']) {
        const socket = await f.connect()
        assert.equal(await request(socket, 'host:transport:PHONE-A'), 'OKAY')
        assert.equal(await request(socket, command), 'FAIL', command)
      }
      assert.deepEqual(f.upstreamRequests, [])
    }
    finally {
 await f.close()
}
  })

  it('accepts Maestro background shell commands with CR/LF/tab in their body', async() => {
    const f = await fixture()
    try {
      const client = await f.connect()
      assert.equal(await request(client, 'host:transport:PHONE-A'), 'OKAY')
      const command = 'shell,v2,raw:am instrument -w -m -e port 33865 ' +
        'dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner &\n\t\r'
      assert.equal(await request(client, command), 'OKAY')
      assert.deepEqual(f.upstreamRequests, ['host:transport:PHONE-A', command])
    }
    finally {
      await f.close()
    }
  })

  it('closes the client and upstream immediately when the parent lease ends', async() => {
    const f = await fixture()
    try {
      const client = await f.connect()
      assert.equal(await request(client, 'host:transport:PHONE-A'), 'OKAY')
      assert.equal(await request(client, 'tcp:7001'), 'OKAY')
      const upstreamSocket = [...f.upstreamSockets][0]!
      const closed = Promise.all([once(client, 'close'), once(upstreamSocket, 'close')])
      f.bridge.closeLease('lease-one')
      await closed
      assert.equal(f.upstreamSockets.size, 0)
    }
    finally {
 await f.close()
}
  })

  it('rejects excess streams without an unhandled error and retains its admission bound',
    async() => {
    const bridge = new LeaseAdbBridge()
    const target = {leaseId: 'lease-limit', serial: 'PHONE-A', host: '127.0.0.1', port: 1}
    try {
      for (let count = 0; count < 32; count++) {
        bridge.accept(new PassThrough(), target, () => {})
      }
      const rejected = new PassThrough()
      const closed = new Promise<void>(resolve => rejected.once('close', resolve))
      bridge.accept(rejected, target, () => {})
      assert.equal(rejected.destroyed, true)
      assert.ok(rejected.listenerCount('error') > 0,
        'Admission rejection must handle its own error')
      await closed
    }
    finally {
      bridge.close()
    }
  })

  it('rejects a stale lease before opening any upstream socket', async() => {
    const f = await fixture()
    try {
      f.expire()
      const client = await f.connect()
      assert.equal(await request(client, 'host:devices'), 'FAIL')
      assert.deepEqual(f.upstreamRequests, [])
    }
    finally {
 await f.close()
}
  })
})
