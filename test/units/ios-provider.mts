import assert from 'node:assert/strict'
import http from 'node:http'
import {once} from 'node:events'
import {WebSocket} from 'ws'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import {IosBridge} from '../../lib/units/ios-provider/bridge.js'
import {PrototypeClient, type IosDeviceState} from '../../lib/units/ios-provider/client.js'
import type {IosDeviceStatus} from '../../lib/util/ios-device-status.js'
import {MjpegDecoder} from '../../lib/units/ios-provider/mjpeg.js'
import {authorizeScreen, type IosOwner} from '../../lib/units/ios-provider/access.js'
import {createScreenServer} from '../../lib/units/ios-provider/screen.js'
import {allowIosPacket} from '../../lib/units/websocket/ios-access.js'

const serial = 'TEST-IPHONE'
const owner = {email: 'owner@example.test', name: 'Owner', group: 'owner-group'}
const origin = 'https://stf.example.test'

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as {port: number}
  return 'http://127.0.0.1:' + address.port
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 2000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the expected operation')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('Linux iOS integration', function() {
  const servers: http.Server[] = []
  afterEach(function() {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      server.close()
    }
  })

  async function fixture(marketName = 'iPhone 16 Plus') {
    const state: IosDeviceState = {
      udid: serial, state: 'ready', generation: 1, instance: 'backend-instance'
    , info: {ProductType: 'iPhone17,4', ProductVersion: '27.0.1'}
    }
    const requests: {path: string, body: any}[] = []
    const sent: {channel: string, envelope: ReturnType<typeof wire.Envelope.decode>}[] = []
    const png = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
    png.writeUInt32BE(1290, 16)
    png.writeUInt32BE(2796, 20)
    const backend = http.createServer(async(req, res) => {
      assert.equal(req.headers.authorization, 'Bearer ' + 'a'.repeat(32))
      if (req.url === '/device') {
        res.end(JSON.stringify(state))
      }
      else if (req.url === '/screenshot') {
        res.setHeader('Content-Type', 'image/png')
        res.end(png)
      }
      else if (req.url === '/screen') {
        res.setHeader('Content-Type', 'multipart/x-mixed-replace;boundary=frame')
        res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\n')
        res.write(Buffer.from('ffd80102ffd9', 'hex'))
        res.write('\r\n\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\n')
        res.write(Buffer.from('ffd80102ffd9', 'hex'))
      }
      else {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(chunk)
        }
        requests.push({path: req.url!, body: JSON.parse(Buffer.concat(chunks).toString())})
        let response = {success: true} as object
        if (req.url?.startsWith('/installations/')) {
          response = {id: requests.at(-1)!.body.id || 'job', settled: false}
        }
        else if (req.url === '/unlock') {
          response = {locked: false}
        }
        res.end(JSON.stringify(response))
      }
    })
    servers.push(backend)
    const client = new PrototypeClient(await listen(backend), 'a'.repeat(32))
    let disconnects = 0
    const bridge = new IosBridge({
      serial, name: 'Linux', marketName, screenUrl: 'wss://stf/screen'
    , storageUrl: 'http://127.0.0.1:1', groupTimeout: 900
    }, client, (channel, data) => sent.push({channel, envelope: wire.Envelope.decode(data)}),
    () => {
 disconnects++
}, () => {})
    function send(message: wireutil.Message, transaction = false, channel = bridge.channel) {
      bridge.handle(channel, transaction ?
        wireutil.transaction('reply', message) : wireutil.envelope(message))
    }
    const join = async(timeout = 900000) => {
      await bridge.poll()
      send(new wire.DeviceRegisteredMessage(serial), false, bridge.solo)
      send(new wire.GroupMessage(owner, timeout, [
        new wire.DeviceRequirement('serial', serial, wire.RequirementType.EXACT)
      ]), true)
      await until(() => bridge.owner !== null)
    }
    return {bridge, client, state, requests, sent, send, join, disconnects: () => disconnects}
  }

  it('registers iOS identity and translates STF input and transactions', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.ProbeMessage())
    const message = f.sent.find(item => item.envelope.type === wire.DeviceIdentityMessage.$code)
    const identity = wire.DeviceIdentityMessage.decode(message!.envelope.message)
    assert.equal(identity.platform, 'iOS')
    assert.equal(identity.model, 'iPhone17,4')
    assert.equal(identity.display.width, 1290)
    f.send(new wire.TouchDownMessage(0, 0, 0.3, 0.4))
    f.send(new wire.TouchUpMessage(1, 0))
    f.send(new wire.PasteMessage('Hello iPhone'), true)
    f.send(new wire.KeyPressMessage('home'))
    await until(() => f.requests.length === 3)
    assert.deepEqual(f.requests.map(req => req.path), ['/tap', '/text', '/home'])
    assert.equal(f.requests[1]!.body.text, 'Hello iPhone')
    assert.ok(f.sent.some(item => item.channel === 'reply' &&
      item.envelope.type === wire.TransactionDoneMessage.$code &&
      wire.TransactionDoneMessage.decode(item.envelope.message).success))
  })

  it('resolves a known iPhone model without a manual market-name override', async function() {
    const f = await fixture('')
    f.state.info!.ProductType = 'iPhone14,2'
    await f.join()
    f.send(new wire.ProbeMessage())
    const message = f.sent.find(item => item.envelope.type === wire.DeviceIdentityMessage.$code)!
    const identity = wire.DeviceIdentityMessage.decode(message.envelope.message)
    assert.equal(identity.marketName, 'iPhone 13 Pro')
    assert.equal(identity.model, 'iPhone14,2')
  })

  it('honors API reservation timeouts expressed in milliseconds', async function() {
    const f = await fixture()
    await f.join(60000)
    const now = Date.now
    const future = now() + 61000
    Date.now = () => future
    try {
      await f.bridge.poll()
      assert.equal(f.bridge.owner, null)
    }
    finally {
      Date.now = now
    }
  })

  it('rejects takeover, foreign channel prefixes and input without ownership', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.GroupMessage({...owner, email: 'other@example.test'}, 900, []), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      !wire.TransactionDoneMessage.decode(item.envelope.message).success))
    assert.equal(f.bridge.owner?.email, owner.email)
    f.send(new wire.KeyPressMessage('home'), false, f.bridge.channel + '-forged')
    f.send(new wire.KeyPressMessage('home'), false, f.bridge.solo)
    f.send(new wire.UngroupMessage([]), true, f.bridge.solo)
    assert.equal(f.bridge.owner?.email, owner.email)
    f.bridge.leave('test')
    f.send(new wire.KeyPressMessage('home'))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 0)
  })

  it('invalidates commands on release and WDA recovery', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.TypeMessage('stale'))
    f.bridge.leave('test')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 0)
    await f.join()
    f.state.generation++
    f.send(new wire.PasteMessage('also stale'), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      !wire.TransactionDoneMessage.decode(item.envelope.message).success))
    assert.equal(f.requests.length, 0)
    await f.bridge.poll()
    assert.equal(f.bridge.owner, null)
    assert.ok(f.disconnects() > 0)
  })

  it('does not turn a multi-finger gesture into an unintended tap', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.TouchDownMessage(0, 0, 0.3, 0.4))
    f.send(new wire.TouchDownMessage(1, 1, 0.6, 0.4))
    f.send(new wire.TouchUpMessage(2, 0))
    f.send(new wire.GestureStopMessage(3))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 0)
  })

  it('accepts IPA blobs only and binds job status and cancellation to ownership', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.InstallMessage('https://private.invalid/app.ipa', true, '{}', 'request'), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      !wire.TransactionDoneMessage.decode(item.envelope.message).success))
    assert.equal(f.requests.length, 0)
    const href = '/s/blob/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' + 'a'.repeat(32)
    f.send(new wire.InstallMessage(href, true, '{}', 'request'), true)
    await until(() => f.requests.length === 1)
    const lease = f.requests[0]!.body.lease
    assert.equal(f.requests[0]!.body.instance, f.state.instance)
    assert.equal(f.requests[0]!.body.generation, f.state.generation)
    f.send(new wire.IosInstallStatusMessage(), true)
    await until(() => f.requests.length === 2)
    assert.equal(f.requests[1]!.body.lease, lease)
    await f.bridge.poll()
    assert.equal(f.requests[2]!.path, '/installations/keepalive')
    f.bridge.leave('test')
    await until(() => f.requests.length === 4)
    assert.deepEqual(f.requests[3], {path: '/installations/cancel', body: {id: 'job', lease}})
    f.send(new wire.IosInstallCancelMessage('job'), true)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.requests.length, 4)
  })

  it('sends Shake only through the owned transaction and rejects stale sessions', async function() {
    const f = await fixture()
    f.send(new wire.IosShakeMessage(), true)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.requests.length, 0)
    await f.join()
    f.send(new wire.IosShakeMessage(), true)
    await until(() => f.requests.length === 1)
    assert.equal(f.requests[0]!.path, '/shake')
    f.state.instance = 'replacement'
    f.send(new wire.IosShakeMessage(), true)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.requests.length, 1)
  })

  it('retains lock-screen access until a real disconnect', async function() {
    const f = await fixture()
    await f.join()
    const disconnects = f.disconnects()
    f.state.ios = {reason: 'locked', locked: true} as IosDeviceStatus
    await f.bridge.poll()
    assert.equal(f.bridge.owner?.email, owner.email)
    assert.ok(!f.sent.some(item => item.envelope.type === wire.DeviceAbsentMessage.$code))
    assert.equal(f.disconnects(), disconnects)
    f.send(new wire.IosUnlockMessage(), true)
    f.send(new wire.IosLockMessage(), true)
    f.send(new wire.KeyPressMessage('home'))
    f.send(new wire.PasteMessage('123456'), true)
    await until(() => f.requests.length === 4)
    assert.deepEqual(f.requests.map(req => req.path), ['/unlock', '/lock', '/home', '/text'])
    f.send(new wire.IosShakeMessage(), true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 4)
    f.state.state = 'waiting'
    f.state.ios.reason = 'disconnected'
    await f.bridge.poll()
    assert.equal(f.bridge.owner, null)
    assert.ok(f.sent.some(item => item.envelope.type === wire.DeviceAbsentMessage.$code))
    const health = f.sent.filter(item => item.envelope.type === wire.DevicePropertiesMessage.$code)
    const message = wire.DevicePropertiesMessage.decode(health.at(-1)!.envelope.message)
    assert.equal(JSON.parse(message.properties[0]!.value).reason, 'disconnected')
  })

  it('requires current ownership for screen lock and power', async function() {
    const f = await fixture()
    const messages = [new wire.IosUnlockMessage(), new wire.IosLockMessage()
      , new wire.IosPowerMessage('reboot'), new wire.IosPowerMessage('shutdown')]
    for (const message of messages) {
      f.send(message, true)
    }
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 0)
    await f.join()
    f.state.ios = {reason: 'locked', locked: true} as IosDeviceStatus
    for (const message of messages) {
      f.send(message, true)
    }
    await until(() => f.requests.length === 4)
    assert.deepEqual(f.requests.map(req => req.path), ['/unlock', '/lock', '/power', '/power'])
    assert.deepEqual(f.requests.slice(2).map(req => req.body.action), ['reboot', 'shutdown'])
    f.send(new wire.IosPowerMessage('erase'), true)
    f.state.instance = 'replacement'
    for (const message of messages) {
      f.send(message, true)
    }
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(f.requests.length, 4)
  })

  it('invalidates commands when the backend restarts at the same generation', async function() {
    const f = await fixture()
    await f.join()
    f.state.instance = 'new-backend-instance'
    f.send(new wire.PasteMessage('stale'), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      !wire.TransactionDoneMessage.decode(item.envelope.message).success))
    assert.equal(f.requests.length, 0)
    await f.bridge.poll()
    assert.equal(f.bridge.owner, null)
  })

  it('checks iOS ownership and group access without changing Android', async function() {
    const user = {email: owner.email, groups: {subscribed: ['root']}}
    const device = {
      serial, platform: 'iOS', channel: 'ios:' + serial, present: true, ready: true
    , group: {id: 'root'}, owner: null as {email: string} | null
    }
    const load = async() => device
    assert.equal(await allowIosPacket('group.invite', device.channel, user, load), true)
    assert.equal(await allowIosPacket('input.keyPress', device.channel, user, load), false)
    assert.equal(await allowIosPacket('device.unlock', device.channel, user, load), false)
    assert.equal(await allowIosPacket('device.iosPower', device.channel, user, load), false)
    device.owner = owner
    assert.equal(await allowIosPacket('device.unlock', device.channel, user, load), true)
    assert.equal(await allowIosPacket('device.lock', device.channel, user, load), true)
    assert.equal(await allowIosPacket('device.iosPower', device.channel, user, load), true)
    assert.equal(await allowIosPacket('input.keyPress', device.channel, user, load), true)
    assert.equal(await allowIosPacket('group.kick', device.channel,
      {...user, email: 'other@example.test'}, load), false)
    assert.equal(await allowIosPacket('group.invite', device.channel,
      {...user, groups: {subscribed: []}}, load), false)
    device.ready = false
    assert.equal(await allowIosPacket('input.keyPress', device.channel, user, load), false)
    assert.equal(await allowIosPacket('input.keyPress', 'android-channel', user,
      () => {
 throw new Error('Android must not query the iOS guard')
}), true)
  })

  it('reassembles split MJPEG frames and rejects missing or oversized lengths', function() {
    const decoder = new MjpegDecoder()
    const part = Buffer.concat([
      Buffer.from('--frame\r\nContent-Length: 6\r\n\r\n')
    , Buffer.from('ffd80102ffd9', 'hex'), Buffer.from('\r\n\r\n')
    ])
    const frames: Buffer[] = []
    const stream = Buffer.concat([part, part])
    for (let i = 0; i < stream.length; i++) {
      frames.push(...decoder.feed(stream.subarray(i, i + 1)))
    }
    assert.equal(frames.length, 2)
    assert.deepEqual(frames[0], Buffer.from('ffd80102ffd9', 'hex'))
    assert.equal(new MjpegDecoder().feed(Buffer.concat([part, part])).length, 2)
    assert.throws(() => new MjpegDecoder().feed(Buffer.from('Content-Length: 99999999\r\n\r\n')))
    assert.throws(() => new MjpegDecoder().feed(Buffer.from('Content-Type: image/jpeg\r\n\r\n')))
  })

  it('authenticates the screen using STF ownership and streams the existing JPEG protocol',
    async function() {
      const f = await fixture()
      let allowed = true
      let viewer = owner.email
      const api = http.createServer((req, res) => {
        assert.equal(req.headers.cookie, 'session=signed')
        if (req.url === '/api/v1/user') {
          res.end(JSON.stringify({success: true, user: {email: viewer}}))
          return
        }
        assert.equal(req.url, '/api/v1/user/devices/' + serial)
        res.writeHead(allowed ? 200 : 403)
        res.end(JSON.stringify({success: allowed, device: {serial, owner}}))
      })
      servers.push(api)
      const apiUrl = await listen(api)
      const headers = {origin, cookie: 'session=signed'}
      assert.equal(await authorizeScreen(apiUrl, origin, serial, owner, headers), true)
      assert.equal(await authorizeScreen(apiUrl, origin, serial, owner,
        {...headers, origin: 'https://foreign.test'}), false)
      assert.equal(await authorizeScreen(apiUrl, origin, serial, null, headers), false)
      viewer = 'admin@example.test'
      assert.equal(await authorizeScreen(apiUrl, origin, serial, owner, headers), false)
      viewer = owner.email
      let currentOwner: IosOwner | null = owner
      const screen = createScreenServer({
        client: f.client, apiUrl, publicOrigin: origin, serial
      , owner: () => currentOwner, keepalive: () => {}
      })
      const url = (await listen(screen.server)).replace('http:', 'ws:')
      const ws = new WebSocket(url, {headers})
      const messages: {data: Buffer, binary: boolean}[] = []
      ws.on('message', (data, binary) => messages.push({data: data as Buffer, binary}))
      try {
        await once(ws, 'open')
        ws.send('on')
        await until(() => messages.filter(message => message.binary).length >= 2)
        assert.ok(messages[0]!.data.toString().startsWith('start '))
        assert.deepEqual(messages.find(message => message.binary)!.data,
          Buffer.from('ffd80102ffd9', 'hex'))
        allowed = false
        assert.equal(await authorizeScreen(apiUrl, origin, serial, owner, headers), false)
        currentOwner = null
        const closed = once(ws, 'close')
        ws.send('ping')
        await closed
      }
      finally {
        ws.terminate()
        screen.close()
      }
    })
})
