import assert from 'node:assert/strict'
import http from 'node:http'
import {once} from 'node:events'
import sinon from 'sinon'
import {WebSocket} from 'ws'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import {IosBridge} from '../../lib/units/ios-provider/bridge.js'
import {PrototypeClient, type IosDeviceState} from '../../lib/units/ios-provider/client.js'
import type {IosDeviceStatus} from '../../lib/util/ios-device-status.js'
import {authorizeScreen} from '../../lib/units/ios-provider/access.js'
import {CoreDeviceScreenDecoder} from '../../lib/units/ios-provider/coredevice-screen.js'
import {createScreenServer} from '../../lib/units/ios-provider/screen.js'
import {allowIosPacket, createDevicePacketGuard} from '../../lib/units/websocket/ios-access.js'

const serial = 'TEST-IPHONE'
const owner = {email: 'owner@example.test', name: 'Owner', group: 'owner-group'}
const origin = 'https://stf.example.test'
const screenSession = 'screen-session'
const hevcUnit = Buffer.from('00000000022601', 'hex')
const hevcPacket = Buffer.concat([Buffer.from('00000007', 'hex'), hevcUnit])
type TouchSample = [type: 'contact' | 'release', x: number, y: number]

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

  async function fixture(marketName = 'iPhone 16 Plus', holdFirstText = false) {
    const state: IosDeviceState = {
      udid: serial, state: 'ready', generation: 1, instance: 'backend-instance'
    , coreDevice: true, ios: {reason: 'ready', locked: false} as IosDeviceStatus
    , info: {ProductType: 'iPhone17,4', ProductVersion: '27.0.1'}
    }
    const requests: {path: string, body: any}[] = []
    let cancelled = false
    let failKeepalive = false
    let automationGate: Promise<void> | undefined
    const errors: unknown[] = []
    const screens: http.ServerResponse[] = []
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
      else if (req.url === '/coredevice/screen') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream'
        , 'X-STF-CoreDevice-Session': screenSession
        , 'X-STF-HEVC-Codec': 'hvc1.1.6.L120.B0'
        , 'X-STF-HEVC-Description': 'AQID'
        })
        screens.push(res)
        res.write(Buffer.concat([hevcPacket, hevcPacket]))
      }
      else if (req.method === 'GET') {
        requests.push({path: req.url!, body: null})
        res.writeHead(404).end('{}')
      }
      else {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(chunk)
        }
        requests.push({path: req.url!, body: JSON.parse(Buffer.concat(chunks).toString())})
        if (req.url === '/installations/keepalive' && failKeepalive) {
          failKeepalive = false
          res.writeHead(502).end('{}')
          return
        }
        if (holdFirstText && req.url === '/text' &&
            requests.filter(item => item.path === '/text').length === 1) {
          res.once('close', () => {
            cancelled = true
          })
          return
        }
        let response = {success: true} as object
        if (req.url === '/automation') {
          const {active, lease} = requests.at(-1)!.body
          await automationGate
          if (active) {
            state.automationLease = lease
          }
          else if (state.automationLease === lease) {
            delete state.automationLease
          }
          response = {active: Boolean(state.automationLease)}
        }
        else if (req.url?.startsWith('/installations/')) {
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
}, error => errors.push(error))
    function send(message: wireutil.Message, transaction = false, channel = bridge.channel) {
      bridge.handle(channel, transaction ?
        wireutil.transaction('reply', message) : wireutil.envelope(message))
    }
    const requestGroup = (timeout: number, usage?: string) => {
      send(new wire.GroupMessage(owner, timeout, [
        new wire.DeviceRequirement('serial', serial, wire.RequirementType.EXACT)
      ], usage), true)
    }
    const join = async(timeout = 900000, usage?: string) => {
      await bridge.poll()
      send(new wire.DeviceRegisteredMessage(serial), false, bridge.solo)
      requestGroup(timeout, usage)
      await until(() => bridge.owner !== null)
    }
    const gestures = new Map<number, string>()
    const gesture = (order: number, screenSessionId = screenSession) => {
      if (!gestures.has(order)) {
        gestures.set(order, '11111111-1111-4111-8111-111111111111:' + order + ':' + Date.now())
      }
      return {gestureId: gestures.get(order)!, reservationId: bridge.owner?.reservationId || null
        , screenSessionId}
    }
    const activateInput = (id = screenSession) => {
      const disconnect = bridge.connectCoreDeviceInput(id, new AbortController().signal,
        error => errors.push(error))
      assert.ok(disconnect)
      return disconnect
    }
    const expectTouches = async(samples: TouchSample[]) => {
      const touches = () => requests.filter(request => request.path === '/coredevice/touch')
      await until(() => touches().length >= samples.length)
      assert.deepEqual(touches().map(request => request.body),
        samples.map(([type, x, y]) => ({
          type, x: Math.fround(x), y: Math.fround(y), sessionId: screenSession
        })))
    }
    const screenServer = (apiUrl: string) => createScreenServer({
      client, apiUrl, publicOrigin: origin, serial, owner: () => bridge.owner
    , mode: () => bridge.screenMode()
    , connectInput: (id, signal, fail) => bridge.connectCoreDeviceInput(id, signal, fail)
    })
    return {bridge, state, requests, sent, send, join, requestGroup, gesture, errors, activateInput
      , expectTouches, screenServer, screens
      , holdAutomation: () => {
        let release = () => {}
        automationGate = new Promise<void>(resolve => {
          release = resolve
        })
        return release
      }
      , failKeepalive: () => {
 failKeepalive = true
}
      , pushFrames: () => screens.forEach(res => res.write(hevcPacket))
      , disconnects: () => disconnects, cancelled: () => cancelled}
  }

  it('publishes iOS automation usage and releases its owner', async function() {
    const f = await fixture()
    await f.join(900000, 'automation')
    const joined = f.sent.find(item => item.envelope.type === wire.JoinGroupMessage.$code)
    const reservation = wire.JoinGroupMessage.decode(joined!.envelope.message)
    assert.equal(reservation.usage, 'automation')
    assert.ok(reservation.owner.reservationId)
    assert.equal(reservation.owner.reservationId, f.bridge.owner?.reservationId)
    const acknowledgement = f.sent.find(item =>
      item.channel === 'reply' && item.envelope.type === wire.TransactionDoneMessage.$code)!
    const response = wire.TransactionDoneMessage.decode(acknowledgement.envelope.message)
    assert.equal(response.success, true)
    assert.equal(JSON.parse(response.body!).owner.reservationId, reservation.owner.reservationId)
    await f.bridge.leave('ungroup_request')
    const left = f.sent.find(item => item.envelope.type === wire.LeaveGroupMessage.$code)
    assert.equal(wire.LeaveGroupMessage.decode(left!.envelope.message).owner.email, owner.email)
    assert.equal(f.bridge.owner, null)
    const transitions = f.requests.filter(request => request.path === '/automation')
    assert.deepEqual(transitions.map(request => request.body), [
      {active: true, lease: reservation.owner.reservationId}
    , {active: false, lease: reservation.owner.reservationId}
    ])
  })

  it('waits for the runtime to acknowledge the automation handoff and release', async() => {
    const f = await fixture()
    await f.join()
    await f.bridge.leave('ungroup_request')
    f.sent.length = 0
    const finishActivation = f.holdAutomation()
    f.requestGroup(900000, 'automation')
    await until(() => f.requests.some(request => request.path === '/automation'))
    assert.equal(Boolean(f.bridge.owner), false)
    assert.equal(f.sent.some(item => item.envelope.type === wire.JoinGroupMessage.$code), false)
    finishActivation()
    await until(() => f.bridge.owner !== null)
    const lease = f.state.automationLease
    assert.equal(lease, f.bridge.owner?.reservationId)

    f.sent.length = 0
    const finishRelease = f.holdAutomation()
    const leaving = f.bridge.leave('ungroup_request')
    f.requestGroup(900000)
    await until(() => f.requests.some(request =>
      request.path === '/automation' && !request.body.active))
    assert.equal(f.sent.length, 0)
    assert.equal(Boolean(f.bridge.owner), false)
    finishRelease()
    await leaving
    await until(() => f.bridge.owner !== null)
    assert.deepEqual(f.sent.slice(0, 2).map(item => item.envelope.type), [
      wire.LeaveGroupMessage.$code, wire.JoinGroupMessage.$code
    ])
    assert.notEqual(f.bridge.owner?.reservationId, lease)
    assert.equal(f.state.automationLease, undefined)
  })

  it('clears an orphaned Appium lease before registering a restarted provider', async() => {
    const f = await fixture()
    f.state.automationLease = '0ecb72bf-710f-491f-8155-2e75983a4347'
    await f.bridge.poll()
    assert.deepEqual(f.requests, [{path: '/automation', body: {
      active: false, lease: '0ecb72bf-710f-491f-8155-2e75983a4347'
    }}])
    assert.equal(f.sent.length, 0)
    await f.join()
    assert.ok(f.bridge.owner)
  })

  for (const viewer of [owner.email, 'viewer@example.test']) {
    const role = viewer === owner.email ? 'owner' : 'group viewer'
    it(`blocks CoreDevice for the automation ${role} without extending the lease`, async() => {
      const f = await fixture()
      await f.join(20000, 'automation')
      const api = http.createServer((req, res) => {
        if (req.url === '/api/v1/user') {
          res.end(JSON.stringify({success: true, user: {email: viewer}}))
        }
        else {
          const path = role === 'owner' ? '/api/v1/user/devices/' : '/api/v1/devices/'
          assert.equal(req.url, path + serial)
          res.end(JSON.stringify({success: true
            , device: {serial, owner: f.bridge.owner, usage: 'automation'}}))
        }
      })
      servers.push(api)
      const apiUrl = await listen(api)
      const headers = {origin, cookie: 'session=signed'}
      assert.equal(await authorizeScreen(apiUrl, origin, serial, f.bridge.owner, headers), true)
      assert.equal(await authorizeScreen(apiUrl, origin, serial, f.bridge.owner, headers,
        'control'), false)
      assert.equal(f.bridge.screenMode(), 'automation')
      assert.equal(f.bridge.connectCoreDeviceInput(screenSession, new AbortController().signal,
        error => f.errors.push(error)), undefined)
      const screen = f.screenServer(apiUrl)
      const url = (await listen(screen.server)).replace('http:', 'ws:')
      const ws = new WebSocket(url, {headers})
      const messages: string[] = []
      ws.on('message', data => messages.push(data.toString()))
      try {
        await once(ws, 'open')
        ws.send('hevc')
        ws.send('on')
        await until(() => messages.includes('hevc automation'))
        ws.send('hevc ready')
        ws.send('ping')
        await until(() => messages.includes('pong'))
        assert.ok(!messages.some(message => message.startsWith('hevc input ready')))
        assert.equal(f.screens.length, 0)
        assert.ok(f.requests.every(request => request.path === '/automation'))
        const now = Date.now
        const future = now() + 21000
        try {
          Date.now = () => future
          await f.bridge.poll()
          assert.equal(f.bridge.owner, null, 'Screen sockets must not renew automation ownership')
        }
        finally {
          Date.now = now
        }
      }
      finally {
        ws.terminate()
        screen.close()
      }
    })
  }

  for (const revoked of ['group visibility', 'viewer token']) {
    it(`rechecks ${revoked} while the automation owner is unchanged`, async function() {
      const f = await fixture()
      await f.join(20000, 'automation')
      const reservationOwner = f.bridge.owner
      let allowed = true
      let identityChecks = 0
      let deviceChecks = 0
      const api = http.createServer((req, res) => {
        if (req.url === '/api/v1/user') {
          identityChecks++
          const visible = allowed || revoked !== 'viewer token'
          res.writeHead(visible ? 200 : 401)
          res.end(JSON.stringify({success: visible, user: {email: 'viewer@example.test'}}))
        }
        else {
          assert.equal(req.url, '/api/v1/devices/' + serial)
          deviceChecks++
          res.writeHead(allowed ? 200 : 403)
          res.end(JSON.stringify({success: allowed
            , device: {serial, owner: reservationOwner, usage: 'automation'}}))
        }
      })
      servers.push(api)
      const apiUrl = await listen(api)
      const clock = sinon.useFakeTimers({toFake: ['setInterval', 'clearInterval']})
      const screen = f.screenServer(apiUrl)
      const ws = new WebSocket((await listen(screen.server)).replace('http:', 'ws:'), {
        headers: {origin, cookie: 'session=signed'}
      })
      const messages: string[] = []
      ws.on('message', data => messages.push(data.toString()))
      try {
        await once(ws, 'open')
        ws.send('hevc')
        ws.send('on')
        await until(() => messages.includes('hevc automation'))
        assert.equal(f.screens.length, 0)
        const closed = once(ws, 'close')
        allowed = false
        clock.tick(5000)
        const [code] = await closed
        assert.equal(code, 1008)
        assert.ok(identityChecks >= 2, 'The screen socket must recheck viewer credentials')
        assert.equal(f.bridge.owner, reservationOwner,
          'Revocation must not release the reservation')
        if (revoked === 'group visibility') {
          assert.ok(deviceChecks >= 2, 'The screen socket must recheck group visibility')
        }
      }
      finally {
        ws.terminate()
        screen.close()
        clock.restore()
      }
    })
  }

  it('aborts forwarded input on release and permits a new session', async function() {
    const f = await fixture('iPhone 16 Plus', true)
    await f.join()
    f.send(new wire.PasteMessage('previous owner'), true)
    await until(() => f.requests.length === 1)
    f.send(new wire.PasteMessage('stale queued input'), true)
    f.bridge.leave('ungroup_request')
    await until(f.cancelled)
    await f.join()
    f.send(new wire.PasteMessage('current owner'), true)
    await until(() => f.requests.length === 2)
    assert.deepEqual(f.requests.map(item => item.body.text), ['previous owner', 'current owner'])
  })

  it('registers iOS identity and translates STF input and transactions', async function() {
    const f = await fixture()
    await f.join()
    f.send(new wire.ProbeMessage())
    const message = f.sent.find(item => item.envelope.type === wire.DeviceIdentityMessage.$code)
    const identity = wire.DeviceIdentityMessage.decode(message!.envelope.message)
    assert.equal(identity.platform, 'iOS')
    assert.equal(identity.model, 'iPhone17,4')
    assert.equal(identity.display.width, 1290)
    assert.equal(identity.display.fps, 0)
    f.send(new wire.PasteMessage('Hello iPhone'), true)
    f.send(new wire.KeyPressMessage('home'))
    await until(() => f.requests.length === 2)
    assert.deepEqual(f.requests.map(req => req.path), ['/text', '/home'])
    assert.equal(f.requests[0]!.body.text, 'Hello iPhone')
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

  it('does not release a new reservation for an old reservation ID', async function() {
    const f = await fixture()
    await f.join()
    const previousId = f.bridge.owner!.reservationId!
    f.bridge.leave('test')
    await f.join()
    const replacement = f.bridge.owner!
    assert.ok(previousId)
    assert.ok(replacement.reservationId)
    assert.notEqual(previousId, replacement.reservationId)
    assert.ok(!('reservationId' in owner), 'The provider must not mutate the caller owner')
    f.send(new wire.UngroupMessage([], previousId), true)
    await until(() => f.sent.some(item =>
      item.envelope.type === wire.TransactionDoneMessage.$code &&
      !wire.TransactionDoneMessage.decode(item.envelope.message).success))
    assert.equal(f.bridge.owner, replacement)
    f.send(new wire.UngroupMessage([], replacement.reservationId), true)
    await until(() => f.bridge.owner === null)
  })

  it('reorders an iOS gesture whose prefix and Stop arrive before Start', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const gesture = f.gesture(1)
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.3, y: 0.4, ...gesture}))
    f.send(new wire.GestureStopMessage({seq: 4, ...gesture}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...gesture}))
    f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
    await f.bridge.poll()
    await f.expectTouches([])
    f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
    await f.expectTouches([['contact', 0.3, 0.4], ['release', 0.3, 0.4]])
  })

  for (const lateStart of [false, true]) {
    it(`recovers a missing Move with ${lateStart ? 'late' : 'early'} Start`, async function() {
      const f = await fixture()
      await f.join()
      f.activateInput()
      const gesture = f.gesture(1)
      if (!lateStart) {
        f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      }
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.3, y: 0.8, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
      // Move 3 is lost; four later packets make the gap safe to skip.
      f.send(new wire.TouchMoveMessage({seq: 4, contact: 0, x: 0.3, y: 0.2, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 5, ...gesture}))
      f.send(new wire.TouchUpMessage({seq: 6, contact: 0, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 7, ...gesture}))
      f.send(new wire.GestureStopMessage({seq: 8, ...gesture}))
      if (lateStart) {
        f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      }
      await f.expectTouches([['contact', 0.3, 0.8], ['contact', 0.3, 0.2]
        , ['release', 0.3, 0.2]])
      const next = f.gesture(2)
      f.send(new wire.GestureStartMessage({seq: 0, ...next}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.7, y: 0.8, ...next}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...next}))
      f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...next}))
      f.send(new wire.GestureStopMessage({seq: 4, ...next}))
      await f.expectTouches([['contact', 0.3, 0.8], ['contact', 0.3, 0.2]
        , ['release', 0.3, 0.2], ['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
    })
  }

  for (const taps of [2, 3]) {
    it(`keeps all ${taps} taps when their prefix arrives before Start`, async function() {
      const f = await fixture()
      await f.join()
      f.activateInput()
      const gesture = f.gesture(1)
      f.send(new wire.GestureStopMessage({seq: taps * 3 + 1, ...gesture}))
      for (let tap = taps - 1; tap >= 0; tap--) {
        f.send(new wire.TouchUpMessage({seq: tap * 3 + 3, contact: 0, ...gesture}))
        f.send(new wire.TouchCommitMessage({seq: tap * 3 + 2, ...gesture}))
        f.send(new wire.TouchDownMessage({
          seq: tap * 3 + 1, contact: 0, x: 0.3 + tap * 0.1, y: 0.4, ...gesture
        }))
      }
      f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      await f.expectTouches(Array.from({length: taps}, (_, tap): TouchSample[] => [
        ['contact', 0.3 + tap * 0.1, 0.4], ['release', 0.3 + tap * 0.1, 0.4]
      ]).flat())
    })
  }

  it('ignores a scoped reset and delayed Start from a previous gesture', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const old = f.gesture(1)
    const current = f.gesture(2)
    f.send(new wire.GestureStartMessage({seq: 0, ...old}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...old}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...old}))
    f.send(new wire.GestureStartMessage({seq: 3, ...current}))
    f.send(new wire.TouchDownMessage({seq: 4, contact: 0, x: 0.7, y: 0.8, ...current}))
    f.send(new wire.TouchCommitMessage({seq: 5, ...current}))
    f.send(new wire.TouchResetMessage({seq: 0, ...old, cancel: true}))
    f.send(new wire.GestureStartMessage({seq: 0, ...old}))
    f.send(new wire.TouchUpMessage({seq: 6, contact: 0, ...current}))
    f.send(new wire.GestureStopMessage({seq: 7, ...current}))
    await f.expectTouches([['contact', 0.2, 0.3], ['release', 0.2, 0.3]
      , ['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
  })

  it('fences delayed gesture input across an ownership change', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const old = f.gesture(1)
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...old}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...old}))
    f.bridge.leave('test')
    await f.join()
    f.activateInput()
    const current = f.gesture(2)
    f.send(new wire.GestureStartMessage({seq: 0, ...old}))
    f.send(new wire.GestureStartMessage({seq: 0, ...current}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.7, y: 0.8, ...current}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...current}))
    f.send(new wire.TouchResetMessage({seq: 0, ...old, cancel: true}))
    for (const reservationId of [old.reservationId, null]) {
      for (const cancel of [true, null]) {
        f.send(new wire.TouchResetMessage({
          seq: 0, gestureId: null, reservationId, screenSessionId: screenSession, cancel
        }))
      }
    }
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...current}))
    f.send(new wire.GestureStopMessage({seq: 4, ...current}))
    await f.expectTouches([['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
  })

  it('drops buffered contacts from a closed CoreDevice screen', async function() {
    const f = await fixture()
    await f.join()
    const disconnect = f.activateInput('previous-screen')
    const old = f.gesture(1, 'previous-screen')
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...old}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...old}))
    disconnect()
    f.activateInput()
    f.send(new wire.GestureStartMessage({seq: 0, ...old}))
    f.send(new wire.TouchMoveMessage({seq: 3, contact: 0, x: 0.2, y: 0.7, ...old}))
    f.send(new wire.TouchUpMessage({seq: 4, contact: 0, ...old}))
    f.send(new wire.GestureStopMessage({seq: 5, ...old}))
    const current = f.gesture(2)
    f.send(new wire.GestureStartMessage({seq: 0, ...current}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.7, y: 0.8, ...current}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...current}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...current}))
    f.send(new wire.GestureStopMessage({seq: 4, ...current}))
    await f.expectTouches([['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
  })

  it('drops late packets and clears incomplete gestures on screen reconnect', async function() {
    const f = await fixture()
    await f.join()
    const disconnect = f.activateInput('previous-screen')
    const old = f.gesture(1, 'previous-screen')
    f.send(new wire.GestureStartMessage({seq: 0, ...old}))
    disconnect()
    f.activateInput()
    const delayed = f.gesture(2, 'previous-screen')
    f.send(new wire.GestureStartMessage({seq: 0, ...delayed}))
    for (const gesture of [old, delayed]) {
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
      f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...gesture}))
    }
    const current = f.gesture(3)
    f.send(new wire.GestureStartMessage({seq: 0, ...current}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.7, y: 0.8, ...current}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...current}))
    f.send(new wire.GestureStopMessage({seq: 4, ...delayed}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...current}))
    f.send(new wire.GestureStopMessage({seq: 4, ...current}))
    await f.expectTouches([['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
    assert.deepEqual(f.errors, [])
  })

  it('cancels a gesture range before promoting its buffered taps', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const first = f.gesture(1)
    f.send(new wire.GestureStartMessage({seq: 0, ...first}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...first}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...first}))
    for (const order of [2, 3]) {
      const gesture = f.gesture(order)
      f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.4, y: 0.5, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
      f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...gesture}))
      f.send(new wire.GestureStopMessage({seq: 4, ...gesture}))
    }
    f.send(new wire.TouchResetMessage({seq: 0, ...f.gesture(3), cancel: true, cancelThrough: true}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...first}))
    f.send(new wire.GestureStopMessage({seq: 4, ...first}))
    const next = f.gesture(4)
    f.send(new wire.GestureStartMessage({seq: 0, ...next}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.7, y: 0.8, ...next}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...next}))
    f.send(new wire.TouchResetMessage({seq: 0, ...f.gesture(3), cancel: true, cancelThrough: true}))
    f.send(new wire.TouchResetMessage({seq: 0, ...next, reservationId: 'another-reservation'
      , cancel: true, cancelThrough: true}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...next}))
    f.send(new wire.GestureStopMessage({seq: 4, ...next}))
    await f.expectTouches([['contact', 0.2, 0.3], ['release', 0.2, 0.3]
      , ['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
  })

  for (const cancel of [true, false]) {
    it(`releases touch with a ${cancel ? 'scoped' : 'sequenced'} reset`, async function() {
      const f = await fixture()
      await f.join()
      f.activateInput()
      const gesture = f.gesture(1)
      f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
      f.send(new wire.TouchResetMessage({seq: 3, ...gesture, cancel}))
      await f.expectTouches([['contact', 0.2, 0.3], ['release', 0.2, 0.3]])
      f.send(new wire.TouchUpMessage({seq: 4, contact: 0, ...gesture}))
      f.send(new wire.GestureStopMessage({seq: 5, ...gesture}))
      f.send(new wire.KeyPressMessage('home'))
      await until(() => f.requests.some(request => request.path === '/home'))
      assert.equal(f.requests.length, 3)
    })
  }

  it('retains scoped cleanup after a sequenced reset within a gesture', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const gesture = f.gesture(1)
    f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...gesture}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
    f.send(new wire.TouchResetMessage({seq: 3, ...gesture, cancel: false}))
    f.send(new wire.TouchDownMessage({seq: 4, contact: 0, x: 0.7, y: 0.8, ...gesture}))
    f.send(new wire.TouchCommitMessage({seq: 5, ...gesture}))
    f.send(new wire.TouchResetMessage({seq: 0, ...gesture, cancel: true}))
    await f.expectTouches([['contact', 0.2, 0.3], ['release', 0.2, 0.3]
      , ['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
    f.send(new wire.TouchUpMessage({seq: 6, contact: 0, ...gesture}))
    f.send(new wire.KeyPressMessage('home'))
    await until(() => f.requests.some(request => request.path === '/home'))
    assert.equal(f.requests.length, 5)
  })

  it('requires reservation, gesture and screen identities for touch', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    f.send(new wire.GestureStartMessage(0))
    f.send(new wire.TouchDownMessage(1, 0, 0.3, 0.4))
    f.send(new wire.TouchCommitMessage(2))
    f.send(new wire.TouchUpMessage(3, 0))
    const missingScreen = {...f.gesture(1), screenSessionId: null}
    f.send(new wire.GestureStartMessage({seq: 0, ...missingScreen}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.3, y: 0.4, ...missingScreen}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...missingScreen}))
    f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...missingScreen}))
    f.send(new wire.KeyPressMessage('home'))
    await until(() => f.requests.length === 1)
    assert.deepEqual(f.requests.map(item => item.path), ['/home'])
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

  it('releases a committed contact when a second finger arrives', async function() {
    const f = await fixture()
    await f.join()
    f.activateInput()
    const gesture = f.gesture(1)
    f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
    f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.3, y: 0.4, ...gesture}))
    f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
    await f.expectTouches([['contact', 0.3, 0.4]])
    f.send(new wire.TouchDownMessage({seq: 3, contact: 1, x: 0.6, y: 0.4, ...gesture}))
    f.send(new wire.TouchCommitMessage({seq: 4, ...gesture}))
    await f.expectTouches([['contact', 0.3, 0.4], ['release', 0.3, 0.4]])
    f.send(new wire.TouchMoveMessage({seq: 5, contact: 0, x: 0.5, y: 0.6, ...gesture}))
    f.send(new wire.TouchUpMessage({seq: 6, contact: 0, ...gesture}))
    f.send(new wire.GestureStopMessage({seq: 7, ...gesture}))
    f.send(new wire.KeyPressMessage('home'))
    await until(() => f.requests.some(request => request.path === '/home'))
    assert.equal(f.requests.length, 3)
  })

  for (const missing of [false, true]) {
    it(`discards the initial two-finger batch if the second contact is ${
      missing ? 'lost' : 'reordered'}`, async function() {
      const f = await fixture()
      await f.join()
      f.activateInput()
      const gesture = f.gesture(1)
      f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.3, y: 0.4, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 3, ...gesture}))
      if (!missing) {
        f.send(new wire.TouchDownMessage({seq: 2, contact: 1, x: 0.6, y: 0.4, ...gesture}))
      }
      f.send(new wire.TouchMoveMessage({seq: 4, contact: 0, x: 0.5, y: 0.6, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 5, ...gesture}))
      f.send(new wire.TouchUpMessage({seq: 6, contact: 0, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 7, ...gesture}))
      f.send(new wire.GestureStopMessage({seq: 8, ...gesture}))
      const next = f.gesture(2)
      f.send(new wire.GestureStartMessage({seq: 9, ...next}))
      f.send(new wire.TouchDownMessage({seq: 10, contact: 0, x: 0.7, y: 0.8, ...next}))
      f.send(new wire.TouchCommitMessage({seq: 11, ...next}))
      f.send(new wire.TouchUpMessage({seq: 12, contact: 0, ...next}))
      f.send(new wire.GestureStopMessage({seq: 13, ...next}))
      await f.expectTouches([['contact', 0.7, 0.8], ['release', 0.7, 0.8]])
    })
  }

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

  it('allows locked install status and cancel but rejects stale runtimes', async function() {
    const f = await fixture()
    await f.join()
    f.sent.length = 0
    f.send(new wire.InstallMessage('/s/blob/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' +
      'a'.repeat(32), true, '{}', 'request'), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      item.envelope.type === wire.TransactionDoneMessage.$code))
    f.state.ios = {reason: 'locked', locked: true} as IosDeviceStatus
    f.send(new wire.IosInstallStatusMessage('request'), true)
    f.send(new wire.IosInstallCancelMessage('request'), true)
    await until(() => f.requests.length === 3)
    assert.deepEqual(f.requests.map(req => req.path), [
      '/installations/start', '/installations/status', '/installations/cancel'
    ])
    assert.ok(f.requests.every(req => req.body.lease === f.requests[0]!.body.lease))
    f.state.instance = 'replacement'
    f.send(new wire.IosInstallCancelMessage('request'), true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests.length, 3)
  })

  it('retains ownership after a transient install keepalive failure', async function() {
    const f = await fixture()
    await f.join()
    f.sent.length = 0
    f.send(new wire.InstallMessage('/s/blob/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' +
      'a'.repeat(32), true, '{}', 'request'), true)
    await until(() => f.sent.some(item => item.channel === 'reply' &&
      item.envelope.type === wire.TransactionDoneMessage.$code))
    const disconnects = f.disconnects()
    f.failKeepalive()
    await f.bridge.poll()
    assert.equal(f.bridge.owner?.email, owner.email)
    assert.equal(f.disconnects(), disconnects)
    assert.equal(f.errors.length, 1)
    assert.ok(!f.sent.some(item => item.envelope.type === wire.DeviceAbsentMessage.$code))
    await f.bridge.poll()
    assert.equal(f.requests.filter(req => req.path === '/installations/keepalive').length, 2)
    assert.ok(!f.requests.some(req => req.path === '/installations/cancel'))
  })

  it('publishes health changes except observation timestamps alone', async function() {
    const f = await fixture()
    f.state.ios = {reason: 'ready', updatedAt: '2026-10-23T10:00:00Z'
      , telemetryAt: '2026-10-23T10:00:00Z', locked: false} as IosDeviceStatus
    const count = () => f.sent.filter(item =>
      item.envelope.type === wire.DevicePropertiesMessage.$code).length
    await f.bridge.poll()
    assert.equal(count(), 1)
    f.state.ios.updatedAt = '2026-10-23T10:00:05Z'
    await f.bridge.poll()
    assert.equal(count(), 1)
    f.state.ios.telemetryAt = '2026-10-23T10:01:00Z'
    await f.bridge.poll()
    assert.equal(count(), 2)
    f.state.ios.locked = true
    f.state.ios.reason = 'locked'
    await f.bridge.poll()
    assert.equal(count(), 3)
    const property = f.sent.filter(item =>
      item.envelope.type === wire.DevicePropertiesMessage.$code).at(-1)!
    const message = wire.DevicePropertiesMessage.decode(property.envelope.message)
    const health = JSON.parse(message.properties[0]!.value)
    assert.equal(health.updatedAt, '2026-10-23T10:00:05Z')
    assert.equal(health.locked, true)
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
    const admin = {...user, email: 'admin@example.test', privilege: 'admin'}
    assert.equal(await allowIosPacket('group.kick', device.channel, admin, load), true)
    assert.equal(await allowIosPacket('device.lock', device.channel, admin, load), true)
    assert.equal(await allowIosPacket('device.lock', device.channel,
      {...admin, groups: {subscribed: []}}, load), false)
    assert.equal(await allowIosPacket('group.invite', device.channel,
      {...user, groups: {subscribed: []}}, load), false)
    device.ready = false
    assert.equal(await allowIosPacket('device.lock', device.channel, admin, load), false)
    assert.equal(await allowIosPacket('input.keyPress', device.channel, user, load), false)
    assert.equal(await allowIosPacket('input.keyPress', 'android-channel', user,
      () => {
 throw new Error('Android must not query the iOS guard')
}), true)
  })

  it('cancels transactions on denied access and failed lookups', async function() {
    const user = {email: owner.email, groups: {subscribed: ['root']}}
    const cancelled: unknown[][] = []
    let fail = false
    const guard = createDevicePacketGuard(user, async() => {
      if (fail) {
        throw new Error('database unavailable')
      }
      return null
    }, (...args) => cancelled.push(args))
    const dispatch = (packet: unknown[]) => new Promise<Error | undefined>(resolve =>
      guard(packet, resolve))
    assert.equal((await dispatch(['device.lock', 'ios:' + serial, 'tx.denied']))?.message,
      'Device access denied')
    fail = true
    assert.equal((await dispatch(['group.kick', 'ios:' + serial, 'tx.lookup']))?.message,
      'Device access unavailable')
    await dispatch(['input.touchDown', 'ios:' + serial])
    assert.equal(cancelled.length, 2)
    assert.deepEqual(cancelled[0], ['tx.denied', {
      source: serial, seq: 0, success: false, data: 'Device access denied'
    }])
    assert.equal((cancelled[1]![1] as {data: string}).data, 'Device access unavailable')
    assert.equal(await dispatch(['input.keyPress', 'android-channel', 'tx.android']), undefined)
  })

  it('preserves input order while an iOS authorization lookup is pending', async function() {
    let release!: () => void
    const pending = new Promise<void>(resolve => {
 release = resolve
})
    let lookups = 0
    const delivered: string[] = []
    const user = {email: owner.email, groups: {subscribed: ['root']}}
    const guard = createDevicePacketGuard(user, async() => {
      if (++lookups === 1) {
        await pending
      }
      return {serial, platform: 'iOS', channel: 'ios:' + serial, present: true
        , ready: true, owner, group: {id: 'root'}}
    }, () => assert.fail('Owned input must not be rejected'))
    guard(['input.gestureStart', 'ios:' + serial], error => {
      assert.ifError(error)
      delivered.push('start')
    })
    guard(['input.touchDown', 'ios:' + serial], error => {
      assert.ifError(error)
      delivered.push('down')
    })
    guard(['input.touchUp', 'ios:' + serial], error => {
      assert.ifError(error)
      delivered.push('up')
    })
    await until(() => lookups === 1)
    assert.deepEqual(delivered, [])
    release()
    await until(() => delivered.length === 3)
    assert.deepEqual(delivered, ['start', 'down', 'up'])
  })

  it('reassembles split HEVC access units and rejects invalid framing', function() {
    const decoder = new CoreDeviceScreenDecoder()
    const stream = Buffer.concat([hevcPacket, hevcPacket])
    const units = [...stream].flatMap(byte => decoder.feed(Uint8Array.of(byte)))
    assert.deepEqual(units, [hevcUnit, hevcUnit])
    assert.throws(() => new CoreDeviceScreenDecoder().feed(Buffer.from('00000006', 'hex')))
    assert.throws(() => new CoreDeviceScreenDecoder().feed(Buffer.from('ffffffff', 'hex')))
    assert.throws(() => new CoreDeviceScreenDecoder().feed(Buffer.from('0000000703000000022601',
      'hex')))
  })

  it('authenticates the screen and forwards live input after HEVC is ready', async function() {
    const f = await fixture()
    await f.join(20000)
    const reservationOwner = f.bridge.owner!
    let allowed = true
    let viewer = owner.email
    let reservationId = reservationOwner.reservationId
    let usage: string | null = null
    const api = http.createServer((req, res) => {
      assert.equal(req.headers.cookie, 'session=signed')
      if (req.url === '/api/v1/user') {
        res.end(JSON.stringify({success: true, user: {email: viewer}}))
        return
      }
      const path = viewer === owner.email ? '/api/v1/user/devices/' : '/api/v1/devices/'
      assert.equal(req.url, path + serial)
      res.writeHead(allowed ? 200 : 403)
      res.end(JSON.stringify({success: allowed
        , device: {serial, owner: {...owner, reservationId}, usage}}))
    })
    servers.push(api)
    const apiUrl = await listen(api)
    const headers = {origin, cookie: 'session=signed'}
    const authorized = () => authorizeScreen(apiUrl, origin, serial, reservationOwner, headers,
      'control')
    assert.equal(await authorized(), true)
    assert.equal(await authorizeScreen(apiUrl, origin, serial, reservationOwner,
      {...headers, origin: 'https://foreign.test'}, 'control'), false)
    assert.equal(await authorizeScreen(apiUrl, origin, serial, null, headers, 'control'), false)
    viewer = 'admin@example.test'
    assert.equal(await authorized(), false)
    viewer = owner.email
    reservationId = 'stale-reservation'
    assert.equal(await authorized(), false)
    reservationId = reservationOwner.reservationId
    usage = 'automation'
    assert.equal(await authorized(), false)
    usage = null
    const screen = f.screenServer(apiUrl)
    const ws = new WebSocket((await listen(screen.server)).replace('http:', 'ws:'), {headers})
    const messages: string[] = []
    const frames: Buffer[] = []
    ws.on('message', (data, binary) => {
      if (binary) {
        frames.push(data as Buffer)
      }
      else {
        messages.push(data.toString())
      }
    })
    try {
      await once(ws, 'open')
      ws.send('hevc')
      ws.send('on')
      await until(() => frames.length >= 2)
      assert.ok(messages[0]!.startsWith('start '))
      assert.deepEqual(JSON.parse(messages[1]!.slice('hevc '.length)),
        {codec: 'hvc1.1.6.L120.B0', description: 'AQID'})
      assert.deepEqual(frames[0], Buffer.concat([Buffer.of(2), hevcUnit.subarray(1)]))
      assert.deepEqual(frames[1], hevcUnit)

      const beforeReady = f.gesture(1)
      f.send(new wire.GestureStartMessage({seq: 0, ...beforeReady}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.2, y: 0.3, ...beforeReady}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...beforeReady}))
      ws.send('hevc ready')
      await until(() => messages.includes('hevc input ready ' + screenSession))
      f.send(new wire.TouchUpMessage({seq: 3, contact: 0, ...beforeReady}))
      f.send(new wire.GestureStopMessage({seq: 4, ...beforeReady}))
      const gesture = f.gesture(2)
      f.send(new wire.GestureStartMessage({seq: 0, ...gesture}))
      f.send(new wire.TouchDownMessage({seq: 1, contact: 0, x: 0.5, y: 0.8, ...gesture}))
      f.send(new wire.TouchCommitMessage({seq: 2, ...gesture}))
      f.send(new wire.TouchMoveMessage({seq: 3, contact: 0, x: 0.5, y: 0.2, ...gesture}))
      await f.expectTouches([['contact', 0.5, 0.8], ['contact', 0.5, 0.2]])
      f.send(new wire.TouchUpMessage({seq: 4, contact: 0, ...gesture}))
      f.send(new wire.GestureStopMessage({seq: 5, ...gesture}))
      await f.expectTouches([['contact', 0.5, 0.8], ['contact', 0.5, 0.2]
        , ['release', 0.5, 0.2]])

      ws.send('hevc keyframe')
      await until(() => f.requests.some(request => request.path === '/coredevice/keyframe'))
      assert.deepEqual(f.requests.at(-1)!.body, {sessionId: screenSession})

      allowed = false
      assert.equal(await authorized(), false)
      const closed = once(ws, 'close')
      const streamClosed = once(f.screens[0]!, 'close')
      const now = Date.now
      const future = now() + 21000
      try {
        Date.now = () => future
        f.pushFrames()
        await f.bridge.poll()
        assert.equal(f.bridge.owner, null, 'Screen frames must not renew device ownership')
      }
      finally {
        Date.now = now
      }
      ws.send('ping')
      const [code] = await closed
      assert.equal(code, 1008)
      await streamClosed
    }
    finally {
      ws.terminate()
      screen.close()
    }
  })

  for (const reason of ['the browser lacks HEVC', 'iOS lacks CoreDevice', 'the iPhone is locked']) {
    it(`reports HEVC status without streaming when ${reason}`, async function() {
      const f = await fixture()
      await f.join()
      if (reason === 'iOS lacks CoreDevice') {
        f.state.coreDevice = false
      }
      else if (reason === 'the iPhone is locked') {
        f.state.ios!.locked = true
      }
      await f.bridge.poll()
      const api = http.createServer((req, res) => {
        res.end(JSON.stringify(req.url === '/api/v1/user' ?
          {success: true, user: owner} : {success: true, device: {serial, owner: f.bridge.owner}}))
      })
      servers.push(api)
      const screen = f.screenServer(await listen(api))
      const ws = new WebSocket((await listen(screen.server)).replace('http:', 'ws:'), {
        headers: {origin, cookie: 'session=signed'}
      })
      const messages: string[] = []
      ws.on('message', data => messages.push(data.toString()))
      try {
        await once(ws, 'open')
        if (reason !== 'the browser lacks HEVC') {
          ws.send('hevc')
        }
        ws.send('on')
        const status = reason === 'the iPhone is locked' ? 'hevc unavailable' : 'hevc unsupported'
        await until(() => messages.includes(status))
        assert.equal(f.screens.length, 0)
        assert.equal(f.requests.length, 0)
        assert.equal(ws.readyState, WebSocket.OPEN)
      }
      finally {
        ws.terminate()
        screen.close()
      }
    })
  }
})
