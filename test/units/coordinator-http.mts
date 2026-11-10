import assert from 'node:assert/strict'
import http from 'node:http'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import WebSocket from 'ws'
import {Coordinator} from '../../lib/units/coordinator/engine.js'
import {HttpFarmBackend} from '../../lib/units/coordinator/backend.js'
import {createCoordinatorApp, attachCoordinatorAdb} from '../../lib/units/coordinator/http.js'
import {CoordinatorAccess} from '../../lib/units/coordinator/access.js'
import {adbRequest} from '../../lib/units/coordinator/adb-bridge.js'
import type {StateStore} from '../../lib/units/coordinator/state.js'
import type {CoordinatorOptions, CoordinatorState, FarmDevice, GridSlot, GridStatus} from
  '../../lib/units/coordinator/types.js'

const apiToken = 'coordinator-test-token-'.repeat(2)
const stfToken = 'stf-private-test-token-'.repeat(2)
const bearer = 'Bearer ' + apiToken
const basic = 'Basic ' + Buffer.from('coordinator:' + apiToken).toString('base64')
const owner = 'coordinator@example.test'
const projectA = 'project-a-private-test-token-'.repeat(2)
const projectB = 'project-b-private-test-token-'.repeat(2)
interface UpstreamCall {
  method: string
  route: string
  body: any
  headers: http.IncomingHttpHeaders
}

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return 'http://127.0.0.1:' + (server.address() as {port: number}).port
}

async function jsonBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return {promise, resolve}
}

class MemoryStore implements StateStore {
  state: CoordinatorState = {version: 2, maintenance: [], requests: [], leases: []}
  fail = false
  async load() {
 return structuredClone(this.state)
}
  async save(state: CoordinatorState) {
    if (this.fail) {
      throw new Error('private filesystem error ' + stfToken)
    }
    this.state = structuredClone(state)
  }
}

describe('coordinator HTTP and real upstream adapters', function() {
  const servers: http.Server[] = []
  const bridges: {close(): void}[] = []
  afterEach(function() {
    for (const bridge of bridges.splice(0)) {
 bridge.close()
}
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      server.close()
    }
  })

  async function fixture(start = true, projects = false) {
    let time = Date.parse('2026-10-18T00:00:00Z')
    const store = new MemoryStore()
    const devices: FarmDevice[] = ['phone-a', 'phone-b'].map(serial => ({
      serial, model: 'Test phone', version: '15', platform: 'Android', provider: 'android-pool'
      , present: true, ready: true, owner: null, usage: null, automationLeaseId: null
    }))
    const grid: GridStatus = {ready: true, nodes: devices.map((_, index) => ({
      id: 'node-' + index, availability: 'UP', slots: [{session: null, stereotype: {
        platformName: 'Android', 'appium:remoteAdbHost': 'adb.test'
      }}]
    }))}
    const stfCalls: UpstreamCall[] = []
    const gridCalls: typeof stfCalls = []
    let nextSession = 0
    let lagNextSessionDeletion = false
    let pendingSlotRetirement: GridSlot | undefined
    let inventoryFails = false
    let inventoryPause: {entered: ReturnType<typeof deferred>
      , release: ReturnType<typeof deferred>} | null = null
    let capturePause: {entered: ReturnType<typeof deferred>
      , release: ReturnType<typeof deferred>} | null = null
    let renewalPause: {serial: string, entered: ReturnType<typeof deferred>
      , release: ReturnType<typeof deferred>} | null = null
    const reply = (res: http.ServerResponse, value: unknown, status = 200) => {
      res.writeHead(status, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(value))
    }
    const stf = http.createServer(async(req, res) => {
      const route = req.url!
      const body = await jsonBody(req)
      stfCalls.push({method: req.method!, route, body, headers: req.headers})
      if (req.headers.authorization !== 'Bearer ' + stfToken) {
        return reply(res, {success: false}, 401)
      }
      if (route === '/api/v1/user') {
        return reply(res, {success: true, user: {email: owner}})
      }
      if (route === '/api/v1/devices') {
        if (inventoryPause) {
          inventoryPause.entered.resolve()
          await inventoryPause.release.promise
        }
        return reply(res, inventoryFails ? {error: 'private upstream failure ' + stfToken} :
          {success: true, devices: devices.map(device => ({...device
            , provider: {name: device.provider}}))}, inventoryFails ? 502 : 200)
      }
      if (route === '/api/v1/user/devices' && req.method === 'POST') {
        if (capturePause) {
          capturePause.entered.resolve()
          await capturePause.release.promise
        }
        const device = devices.find(item => item.serial === body.serial)!
        device.owner = {email: owner}
        device.usage = 'automation'
        device.automationLeaseId = body.leaseId
        return reply(res, {success: true
          , ...(body.automationRunner ? {automationRunner: body.automationRunner} : {})})
      }
      const operation =
        /^\/api\/v1\/user\/devices\/([^/]+)\/automation\/(renew|release)$/.exec(route)
      if (operation) {
        if (operation[2] === 'renew' && renewalPause &&
            decodeURIComponent(operation[1]!) === renewalPause.serial) {
          renewalPause.entered.resolve()
          await renewalPause.release.promise
        }
        const device = devices.find(item => item.serial === decodeURIComponent(operation[1]!))!
        if (!device.owner || device.automationLeaseId !== body.leaseId) {
          return reply(res, {success: false}, 409)
        }
        if (operation[2] === 'release') {
          device.owner = null
          device.usage = null
          device.automationLeaseId = null
        }
        return reply(res, {success: true})
      }
      return reply(res, {success: false}, 404)
    })
    const appium = http.createServer(async(req, res) => {
      const route = req.url!
      const body = await jsonBody(req)
      gridCalls.push({method: req.method!, route, body, headers: req.headers})
      if (route === '/status') {
        reply(res, {value: grid})
        if (pendingSlotRetirement) {
          pendingSlotRetirement.session = null
          pendingSlotRetirement = undefined
          grid.ready = true
        }
        return
      }
      if (route === '/session' && req.method === 'POST') {
        const slot = grid.nodes.flatMap(node => node.slots).find(item => !item.session)!
        const sessionId = 'session-' + (++nextSession)
        slot.session = {sessionId, capabilities: body.capabilities.alwaysMatch}
        return reply(res, {value: {sessionId, capabilities: slot.session.capabilities}})
      }
      const session = /^\/session\/([^/]+)(\/.*)?$/.exec(route)
      const slot = grid.nodes.flatMap(node => node.slots)
        .find(item => item.session?.sessionId === session?.[1])
      if (!slot) {
        return reply(res, {value: {error: 'invalid session id', message: 'Unknown session'}}, 404)
      }
      if (req.method === 'DELETE' && !session![2]) {
        if (lagNextSessionDeletion) {
          lagNextSessionDeletion = false
          pendingSlotRetirement = slot
        }
        else {
          slot.session = null
        }
        return reply(res, {value: null})
      }
      return reply(res, {value: session![2] === '/source' ? '<App/>' : null})
    })
    servers.push(stf, appium)
    const stfUrl = await listen(stf)
    const gridUrl = await listen(appium)
    const options: CoordinatorOptions = {
      host: '127.0.0.1', port: 8080, publicUrl: 'http://127.0.0.1:8080'
      , stfApiUrl: stfUrl, appiumGridUrl: gridUrl, stfTokenFile: '/unused/stf'
      , apiTokenFile: '/unused/api', stateFile: '/unused/state', adbPoolsFile: '/unused/pools'
      , leaseTtlSeconds: 180, heartbeatIntervalSeconds: 30, pollIntervalSeconds: 1
      , maxDurationSeconds: 21600, maxParallel: 2, upstreamTimeoutSeconds: 1
    }
    const backend = new HttpFarmBackend(stfUrl, gridUrl, stfToken, 1000)
    backend.maestroBaseline = async() => ({packages: [], settings: {}})
    backend.maestroPrepare = async() => {}
    const engine = new Coordinator(options, [{provider: 'android-pool', host: 'adb.test'
      , port: 5037, systemPorts: [8200, 8201]}], backend, store, () => time)
    if (start) {
      await engine.start()
    }
    const access = new CoordinatorAccess(apiToken, projects ? [
      {id: 'a', tokenSha256: createHash('sha256').update(projectA).digest('hex'), maxParallel: 1}
    , {id: 'b', tokenSha256: createHash('sha256').update(projectB).digest('hex'), maxParallel: 1}
    ] : [])
    const app = http.createServer(createCoordinatorApp(engine, access))
    bridges.push(attachCoordinatorAdb(app, engine, access))
    servers.push(app)
    const url = await listen(app)
    options.publicUrl = url
    const call = async(route: string, method = 'GET', body?: unknown,
      auth: string | null = bearer, headers: Record<string, string> = {}) => {
      const response = await fetch(url + route, {method, redirect: 'error'
        , headers: {'Content-Type': 'application/json', ...(auth ? {Authorization: auth} : {})
          , ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
      return {status: response.status, headers: response.headers
      , body: await response.json() as any}
    }
    const allocate = async(key = 'run-a') => {
      const response = await call('/api/v1/requests', 'POST', {runId: key, platform: 'Android'},
        bearer, {'Idempotency-Key': key})
      assert.equal(response.status, 202)
      await engine.tick()
      const request = await call('/api/v1/requests/' + response.body.request.id)
      assert.equal(request.body.request.state, 'allocated')
      const lease = await call('/api/v1/leases/' + request.body.request.leaseId)
      return lease.body.lease
    }
    return {engine, backend, store, devices, grid, stfCalls, gridCalls, url, call, allocate
      , lagSessionDeletion() {
        grid.ready = false
        lagNextSessionDeletion = true
      }
      , advance(milliseconds: number) {
 time += milliseconds
}
      , failInventory() {
 inventoryFails = true
}
      , pauseInventory() {
        inventoryPause = {entered: deferred(), release: deferred()}
        return inventoryPause
      }
      , pauseCapture() {
        capturePause = {entered: deferred(), release: deferred()}
        return capturePause
      }
      , pauseRenewal(serial: string) {
        renewalPause = {serial, entered: deferred(), release: deferred()}
        return renewalPause
      }}
  }

  async function uncertainCapture() {
    const f = await fixture(false, true)
    const createdAt = Date.parse('2026-10-17T23:00:00Z')
    const id = '7c8b73f0-f012-49a7-9ce4-5b9ec8048afb'
    f.store.state.requests.push({id: 'failed-capture', projectId: 'a', key: 'uncertain'
      , fingerprint: 'failed-capture', input: {runId: 'uncertain', platform: 'Android'
        , queueTimeoutSeconds: 60, maxDurationSeconds: 1800}, state: 'failed'
      , createdAt, queueDeadlineAt: createdAt + 60000, leaseId: id, error: 'allocation_failed'})
    f.store.state.leases.push({id, projectId: 'a', requestId: 'failed-capture'
      , runId: 'uncertain', runner: 'appium', state: 'quarantined'
      , device: structuredClone(f.devices[0]!), capabilities: {'appium:udid': 'phone-a'
        , 'appium:remoteAdbHost': 'adb.test', platformName: 'Android'}
      , createdAt, expiresAt: createdAt + 180000, deadlineAt: createdAt + 1800000
      , captureUncertain: true, finishState: 'released', error: 'cleanup_unconfirmed'})
    await f.engine.start()
    const body = {reconcileUnowned: true, serial: 'phone-a', captureTransportRetired: true
      , reason: 'Capture producer, all bus queues and consumer were retired under maintenance.'}
    return {...f, id, route: '/api/v1/leases/' + id + '/recover', body}
  }

  it('requires a complete operator acknowledgement before reconciling uncertain capture',
    async function() {
      const f = await uncertainCapture()
      const original = structuredClone(f.store.state)
      for (const body of [null, [], {force: true}, {...f.body, extra: true}
        , {...f.body, actor: 'operator'}, {...f.body, projectId: 'a'}
        , {...f.body, reconcileUnowned: false}, {...f.body, captureTransportRetired: false}
        , {...f.body, captureTransportRetired: 'true'}, {...f.body, serial: ''}
        , {...f.body, serial: 'phone-a\n'}, {...f.body, reason: ''}
        , {...f.body, reason: ' '}, {...f.body, reason: 'not\nretired'}
        , {...f.body, reason: 'x'.repeat(1025)}
        , {reconcileUnowned: true, serial: 'phone-a'}]) {
        const before = f.stfCalls.length
        const response = await f.call(f.route, 'POST', body)
        assert.equal(response.status, 400)
        assert.equal(f.stfCalls.length, before)
        assert.deepEqual(f.store.state, original)
      }
      assert.equal((await f.call(f.route, 'POST', f.body, null)).status, 401)
      for (const token of [projectA, projectB]) {
        assert.equal((await f.call(f.route, 'POST', f.body, 'Bearer ' + token)).status, 403)
      }
      assert.equal((await f.call(f.route, 'POST', {...f.body, serial: 'phone-b'})).status, 409)
      assert.deepEqual(f.store.state, original)
    })

  it('keeps ordinary cleanup conservative and explicitly audits operator reconciliation',
    async function() {
      const f = await uncertainCapture()
      const history = structuredClone(f.store.state.requests)
      assert.equal((await f.call(f.route, 'POST', {})).status, 202)
      assert.equal(f.store.state.leases[0]!.state, 'quarantined')
      const response = await f.call(f.route, 'POST', f.body)
      assert.equal(response.status, 202)
      assert.equal(response.body.lease.state, 'expired')
      const lease = f.store.state.leases[0]!
      assert.equal(lease.captureUncertain, undefined)
      assert.equal(lease.error, undefined)
      assert.deepEqual(lease.captureReconciliation, {at: Date.parse('2026-10-18T00:00:00Z')
        , previousError: 'cleanup_unconfirmed', mode: 'unowned-capture'
        , captureTransportRetired: true, reason: f.body.reason, actor: 'operator'
        , projectId: 'legacy'})
      assert.deepEqual(f.store.state.requests, history)
      assert.equal(f.store.state.leases.length, 1)
      assert.ok(f.stfCalls.every(call => call.method === 'GET'))
      assert.ok(f.gridCalls.every(call => call.method === 'GET' && call.route === '/status'))
      const saved = structuredClone(f.store.state)
      f.advance(1000)
      assert.equal((await f.call(f.route, 'POST', f.body)).status, 202)
      assert.deepEqual(f.store.state, saved)
      assert.equal((await f.call(f.route, 'POST', {...f.body, serial: 'phone-b'})).status, 409)
      assert.deepEqual(f.store.state, saved)
    })

  it('can retry reconciliation when the HTTP connection closes after its durable save',
    async function() {
      const f = await uncertainCapture()
      const entered = deferred()
      const release = deferred()
      const originalSave = f.store.save.bind(f.store)
      let commits = 0
      f.store.save = async state => {
        await originalSave(state)
        commits++
        entered.resolve()
        await release.promise
      }
      const abort = new AbortController()
      const pending = fetch(f.url + f.route, {method: 'POST', signal: abort.signal
        , headers: {Authorization: bearer, 'Content-Type': 'application/json'}
        , body: JSON.stringify(f.body)})
      const rejected = assert.rejects(pending, error => (error as Error).name === 'AbortError')
      await entered.promise
      abort.abort()
      release.resolve()
      await rejected
      const response = await f.call(f.route, 'POST', f.body)
      assert.equal(response.status, 202)
      assert.equal(response.body.lease.state, 'expired')
      assert.equal(commits, 1)
      assert.equal(f.store.state.leases[0]!.captureReconciliation!.previousError,
        'cleanup_unconfirmed')
    })

  it('exposes readiness before recovery and refuses allocation before startup', async function() {
    const f = await fixture(false)
    assert.deepEqual((await f.call('/healthz', 'GET', undefined, null)).body, {healthy: true})
    assert.equal((await f.call('/readyz', 'GET', undefined, null)).status, 503)
    const response = await f.call('/api/v1/requests', 'POST', {runId: 'early', platform: 'Android'},
      bearer, {'Idempotency-Key': 'early'})
    assert.equal(response.status, 503)
    assert.equal(f.stfCalls.length, 0)
    await f.engine.start()
    assert.equal((await f.call('/readyz', 'GET', undefined, null)).status, 200)
  })

  it('accepts Bearer and Basic authentication and rejects wrong tokens', async function() {
    const f = await fixture()
    for (const token of [bearer, basic]) {
      const result = await f.call('/api/v1/status', 'GET', undefined, token)
      assert.equal(result.status, 200)
      assert.equal(result.headers.get('cache-control'), 'no-store')
    }
    for (const token of [null, 'Bearer wrong', 'Basic ' +
      Buffer.from('other:' + apiToken).toString('base64')]) {
      const result = await f.call('/api/v1/status', 'GET', undefined, token)
      assert.equal(result.status, 401)
      assert.match(result.headers.get('www-authenticate')!, /Basic/)
      assert.doesNotMatch(JSON.stringify(result.body), new RegExp(apiToken))
    }
  })

  it('validates allocation input and enforces HTTP idempotency before dispatch', async function() {
    const f = await fixture()
    const body = {runId: 'run-a', platform: 'Android'}
    assert.equal((await f.call('/api/v1/requests', 'POST', body)).status, 400)
    for (const invalid of [[], {...body, extra: true}, {...body, platform: 'Windows'}
      , {...body, runId: ''}, {...body, queueTimeoutSeconds: 0}
      , {...body, maxDurationSeconds: 21601}]) {
      assert.equal((await f.call('/api/v1/requests', 'POST', invalid, bearer,
        {'Idempotency-Key': 'invalid'})).status, 400)
    }
    const first = await f.call('/api/v1/requests', 'POST', body, bearer,
      {'Idempotency-Key': 'same'})
    const again = await f.call('/api/v1/requests', 'POST', body, bearer,
      {'Idempotency-Key': 'same'})
    assert.equal(first.body.request.id, again.body.request.id)
    assert.equal((await f.call('/api/v1/requests', 'POST', {...body, runId: 'other'}, bearer,
      {'Idempotency-Key': 'same'})).status, 409)
    assert.equal(f.stfCalls.filter(item => item.method === 'POST').length, 0)
  })

  it('runs W3C sessions, heartbeat and fenced cleanup over HTTP', async function() {
    const f = await fixture()
    f.grid.nodes.splice(1)
    const lease = await f.allocate()
    const gateway = '/api/v1/leases/' + lease.id + '/webdriver'
    const created = await f.call(gateway + '/session', 'POST', {capabilities: {
      alwaysMatch: {'appium:appPackage': 'test.package'}, firstMatch: [{}]
    }}, basic, {Cookie: 'private-cookie=secret', 'Idempotency-Key': 'private-idempotency'})
    assert.equal(created.status, 200)
    const session = created.body.value.sessionId
    assert.equal((await f.call(gateway + '/session/' + session + '/source')).body.value, '<App/>')
    const posted = f.gridCalls.find(item => item.route === '/session')!.body
    assert.equal(posted.capabilities.alwaysMatch['appium:udid'], lease.device.serial)
    assert.equal(posted.capabilities.alwaysMatch['appium:systemPort'], 8200)
    assert.equal(posted.capabilities.alwaysMatch['stf:leaseId'], lease.id)
    f.advance(60000)
    const renewed = await f.call('/api/v1/leases/' + lease.id + '/renew', 'POST', {})
    assert.equal(renewed.status, 200)
    assert.ok(Date.parse(renewed.body.lease.expiresAt) > Date.parse(lease.expiresAt))
    const observations = f.gridCalls.filter(item => item.route === '/status').length
    f.lagSessionDeletion()
    assert.equal((await f.call(gateway + '/session/' + session, 'DELETE')).status, 200)
    assert.equal(f.gridCalls.filter(item => item.route === '/status').length, observations + 2)
    assert.equal((await f.call('/api/v1/leases/' + lease.id, 'DELETE')).status, 202)
    await f.engine.tick()
    assert.equal((await f.call('/api/v1/leases/' + lease.id)).body.lease.state, 'released')
    assert.equal(f.devices[0]!.owner, null)
    assert.ok(f.stfCalls.some(item => item.route.endsWith('/automation/release') &&
      item.body.leaseId === lease.id))
    for (const call of f.gridCalls) {
      assert.equal(call.headers.authorization, undefined)
      assert.equal(call.headers.cookie, undefined)
      assert.equal(call.headers['idempotency-key'], undefined)
      assert.doesNotMatch(JSON.stringify(call), new RegExp(apiToken + '|' + stfToken))
    }
    assert.ok(f.stfCalls.every(call => call.headers.authorization === 'Bearer ' + stfToken))
  })

  it('omits parsed JSON bodies from upstream GET and HEAD WebDriver commands', async function() {
    const f = await fixture()
    const lease = await f.allocate()
    const gateway = '/api/v1/leases/' + lease.id + '/webdriver'
    const created = await f.call(gateway + '/session', 'POST', {
      capabilities: {alwaysMatch: {}, firstMatch: [{}]}
    })
    assert.equal(created.status, 200)
    const route = '/session/' + created.body.value.sessionId + '/source'
    for (const method of ['GET', 'HEAD']) {
      // Explicit JSON reproduces a parsed GET body without mocking the upstream adapter.
      const result = await new Promise<{status: number, body: string}>((resolve, reject) => {
        const request = http.request(f.url + gateway + route, {
          method, headers: {Authorization: bearer, 'Content-Type': 'application/json'
            , 'Content-Length': 2}
        }, response => {
          const chunks: Buffer[] = []
          response.on('data', chunk => chunks.push(Buffer.from(chunk)))
          response.once('end', () => resolve({status: response.statusCode!
            , body: Buffer.concat(chunks).toString()}))
          response.once('error', reject)
        })
        request.once('error', reject)
        request.end('{}')
      })
      assert.equal(result.status, 200, result.body)
      if (method === 'GET') {
        assert.equal(JSON.parse(result.body).value, '<App/>')
      }
      else {
        assert.equal(result.body, '')
      }
      const forwarded = f.gridCalls.find(call => call.method === method && call.route === route)
      assert.ok(forwarded, 'The command must reach the real upstream HTTP adapter')
      assert.equal(forwarded.body, null, method + ' must not carry a JSON payload upstream')
      assert.ok(!forwarded.headers['content-length'] || forwarded.headers['content-length'] === '0')
      assert.equal(f.engine.leaseView(lease.id).state, 'active')
    }
  })

  for (const phase of ['inventory', 'capture'] as const) {
    it(`keeps HTTP heartbeat and commands available during slow ${phase}`, async function() {
      const f = await fixture()
      const active = await f.allocate('active-worker')
      const gateway = '/api/v1/leases/' + active.id + '/webdriver'
      const created = await f.call(gateway + '/session', 'POST', {capabilities: {
        firstMatch: [{platformName: 'ANDROID'}]
      }})
      assert.equal(created.status, 200)
      await f.call('/api/v1/requests', 'POST', {runId: 'slow', platform: 'Android'},
        bearer, {'Idempotency-Key': 'slow'})
      const pause = phase === 'inventory' ? f.pauseInventory() : f.pauseCapture()
      const scheduling = f.engine.tick()
      await pause.entered.promise
      try {
        f.advance(60000)
        const heartbeat = await Promise.race([
          f.call('/api/v1/leases/' + active.id + '/renew', 'POST', {})
        , new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('HTTP heartbeat blocked by scheduling IO')), 500)
        })])
        assert.equal(heartbeat.status, 200)
        assert.ok(Date.parse(heartbeat.body.lease.expiresAt) > Date.parse(active.expiresAt))
        const source = await f.call(gateway + '/session/' +
          created.body.value.sessionId + '/source')
        assert.equal(source.status, 200)
        assert.equal(source.body.value, '<App/>')
      }
      finally {
        pause.release.resolve()
        await scheduling
      }
    })
  }

  it('does not block another HTTP worker behind a slow gateway ownership check', async function() {
    const f = await fixture()
    const first = await f.allocate('first-worker')
    const second = await f.allocate('second-worker')
    const pause = f.pauseRenewal(first.device.serial)
    const gateway = f.call('/api/v1/leases/' + first.id + '/webdriver/session', 'POST', {
      capabilities: {firstMatch: [{platformName: 'ANDROID'}]}
    })
    await pause.entered.promise
    try {
      f.advance(60000)
      const heartbeat = await Promise.race([
        f.call('/api/v1/leases/' + second.id + '/renew', 'POST', {})
      , new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('HTTP heartbeat blocked by gateway fence IO')), 500)
      })])
      assert.equal(heartbeat.status, 200)
    }
    finally {
      pause.release.resolve()
      assert.equal((await gateway).status, 200)
    }
  })

  it('rejects nested and firstMatch connection overrides before contacting Grid', async function() {
    const f = await fixture()
    const lease = await f.allocate()
    const route = '/api/v1/leases/' + lease.id + '/webdriver/session'
    for (const supplied of [
      {alwaysMatch: {'appium:options': {udid: 'foreign'}}}
      , {firstMatch: [{'appium:systemPort': 8999}]}
      , {alwaysMatch: {'appium:udid': 'foreign'}, firstMatch: [{}]}
    ]) {
      const response = await f.call(route, 'POST', {capabilities: supplied})
      assert.ok([400, 409].includes(response.status))
      assert.equal(response.body.value.stacktrace, '')
    }
    assert.equal(f.gridCalls.filter(call => call.route === '/session').length, 0)
  })

  it('rejects malformed W3C arrays rather than silently rewriting them', async function() {
    const f = await fixture()
    const lease = await f.allocate()
    const route = '/api/v1/leases/' + lease.id + '/webdriver/session'
    for (const capabilities of [[], {alwaysMatch: []}, {firstMatch: []}, {firstMatch: [[]]}]) {
      const result = await f.call(route, 'POST', {capabilities})
      assert.equal(result.status, 400, 'Invalid capabilities: ' + JSON.stringify(capabilities))
    }
    assert.equal(f.gridCalls.filter(call => call.route === '/session').length, 0)
  })

  it('prevents a lease from sending commands to another lease session', async function() {
    const f = await fixture()
    const first = await f.allocate('first')
    const second = await f.allocate('second')
    const firstPath = '/api/v1/leases/' + first.id + '/webdriver/session'
    const secondPath = '/api/v1/leases/' + second.id + '/webdriver/session'
    const body = {capabilities: {alwaysMatch: {}, firstMatch: [{}]}}
    const own = await f.call(firstPath, 'POST', body)
    const foreign = await f.call(secondPath, 'POST', body)
    assert.notEqual(own.body.value.sessionId, foreign.body.value.sessionId)
    const count = f.gridCalls.length
    const result = await f.call(firstPath + '/' + foreign.body.value.sessionId + '/source')
    assert.equal(result.status, 404)
    assert.equal(result.body.value.error, 'invalid session id')
    assert.equal(f.gridCalls.length, count)
  })

  it('rejects encoded traversal and queries before forwarding', async function() {
    const f = await fixture()
    const lease = await f.allocate()
    const prefix = '/api/v1/leases/' + lease.id + '/webdriver'
    const before = f.gridCalls.length
    for (const route of ['/session/%2e%2e/status', '/session/a%2fb/source'
      , '/session/a%5cb/source', '/session/a%00/source', '/session/%E0%A4%A/source'
      , '/session/a/source?forwarded=true']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(f.url + '/', {method: 'GET', path: prefix + route
          , headers: {Authorization: bearer}}, res => {
          res.resume()
          res.on('end', () => resolve(res.statusCode!))
        })
        req.on('error', reject)
        req.end()
      })
      assert.ok(status >= 400 && status < 500, route + ' returned ' + status)
    }
    assert.equal(f.gridCalls.length, before)
  })

  it('GET polling never renews worker ownership', async function() {
    const f = await fixture()
    const lease = await f.allocate()
    const renews = f.stfCalls.filter(call => call.route.endsWith('/automation/renew')).length
    f.advance(60000)
    for (const route of ['/api/v1/status', '/api/v1/leases', '/api/v1/leases/' + lease.id
      , '/api/v1/requests/' + lease.requestId]) {
      assert.equal((await f.call(route)).status, 200)
    }
    const current = (await f.call('/api/v1/leases/' + lease.id)).body.lease
    assert.equal(current.expiresAt, lease.expiresAt)
    assert.equal(f.stfCalls.filter(call => call.route.endsWith('/automation/renew')).length, renews)
    assert.equal((await f.call('/api/v1/leases/' + lease.id + '/renew')).status, 404)
  })

  it('namespaces idempotency and enforces fair project quotas', async function() {
    const f = await fixture(true, true)
    const submit = async(token: string, key: string) => {
      const result = await f.call('/api/v1/requests', 'POST', {runId: key, platform: 'Android'},
        'Bearer ' + token, {'Idempotency-Key': key})
      assert.equal(result.status, 202)
      return result.body.request
    }
    const first = await submit(projectA, 'shared-key')
    const queued = await submit(projectA, 'second-a')
    const other = await submit(projectB, 'shared-key')
    assert.notEqual(first.id, other.id)
    await f.engine.tick()
    const a = (await f.call('/api/v1/requests/' + first.id, 'GET', undefined,
      'Bearer ' + projectA)).body.request
    assert.equal(a.state, 'allocated')
    assert.equal((await f.call('/api/v1/requests/' + queued.id, 'GET', undefined,
      'Bearer ' + projectA)).body.request.state, 'queued')
    assert.equal((await f.call('/api/v1/requests/' + other.id, 'GET', undefined,
      'Bearer ' + projectB)).body.request.state, 'allocated')
    assert.equal((await f.call('/api/v1/leases', 'GET', undefined,
      'Bearer ' + projectA)).body.leases.length, 1)
    for (const [method, route] of [
      ['GET', '/api/v1/requests/' + first.id], ['DELETE', '/api/v1/requests/' + first.id]
    , ['GET', '/api/v1/leases/' + a.leaseId], ['DELETE', '/api/v1/leases/' + a.leaseId]
    , ['POST', '/api/v1/leases/' + a.leaseId + '/renew']
    , ['POST', '/api/v1/leases/' + a.leaseId + '/webdriver/session']
    ]) {
      assert.equal((await f.call(route!, method!, method === 'GET' ? undefined : {},
        'Bearer ' + projectB)).status, 404)
    }
    assert.equal((await f.call('/api/v1/leases/' + a.leaseId + '/recover', 'POST', {},
      'Bearer ' + projectA)).status, 403)
    await f.call('/api/v1/leases/' + a.leaseId, 'DELETE', undefined, 'Bearer ' + projectA)
    await f.engine.tick()
    assert.equal((await f.call('/api/v1/requests/' + queued.id, 'GET', undefined,
      'Bearer ' + projectA)).body.request.state, 'allocated')
  })

  it('authenticates, pins and revokes ADB WebSockets', async function() {
    const f = await fixture(true, true)
    const result = await f.call('/api/v1/requests', 'POST',
      {runId: 'maestro', runner: 'maestro', platform: 'Android'},
      'Bearer ' + projectA, {'Idempotency-Key': 'maestro'})
    assert.equal(result.status, 202)
    await f.engine.tick()
    const request = (await f.call('/api/v1/requests/' + result.body.request.id, 'GET',
      undefined, 'Bearer ' + projectA)).body.request
    assert.equal(request.state, 'allocated')
    const lease = (await f.call('/api/v1/leases/' + request.leaseId, 'GET', undefined,
      'Bearer ' + projectA)).body.lease
    const url = f.url.replace(/^http/, 'ws') + lease.connection.path
    const denied = (token: string) => new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url, {headers: {Authorization: 'Bearer ' + token}})
      ws.on('error', () => {})
      ws.on('open', () => {
 ws.terminate(); reject(new Error('Unauthorized upgrade succeeded'))
})
      ws.on('unexpected-response', (_req, res) => {
 res.resume(); resolve(res.statusCode!)
})
    })
    assert.equal(await denied('invalid'), 401)
    assert.equal(await denied(projectB), 404)
    const ws = new WebSocket(url, {headers: {Authorization: 'Bearer ' + projectA}})
    ws.on('error', () => {})
    await once(ws, 'open')
    const chunks: Buffer[] = []
    ws.on('message', data => chunks.push(Buffer.from(data as Buffer)))
    const closed = once(ws, 'close')
    ws.send(adbRequest('host:devices'), {binary: true})
    assert.equal((await closed)[0], 1000)
    const devices = Buffer.concat(chunks).toString()
    assert.match(devices, new RegExp(lease.device.serial + '\\tdevice'))
    assert.doesNotMatch(devices,
      new RegExp(lease.device.serial === 'phone-a' ? 'phone-b' : 'phone-a'))
    const idle = new WebSocket(url, {headers: {Authorization: 'Bearer ' + projectA}})
    idle.on('error', () => {})
    await once(idle, 'open')
    const revoked = once(idle, 'close')
    await f.call('/api/v1/leases/' + lease.id, 'DELETE', undefined, 'Bearer ' + projectA)
    assert.notEqual((await revoked)[0], 1000)
  })

  it('reclaims normal ADB EOF streams across repeated Dadb metadata connections', async function() {
    const f = await fixture(true, true)
    const result = await f.call('/api/v1/requests', 'POST',
      {runId: 'maestro-many-connections', runner: 'maestro', platform: 'Android'},
      'Bearer ' + projectA, {'Idempotency-Key': 'maestro-many-connections'})
    assert.equal(result.status, 202)
    await f.engine.tick()
    const request = (await f.call('/api/v1/requests/' + result.body.request.id, 'GET',
      undefined, 'Bearer ' + projectA)).body.request
    const lease = f.engine.leaseView(request.leaseId)
    const url = f.url.replace(/^http/, 'ws') + lease.connection.path
    for (let count = 0; count < 100; count++) {
      const ws = new WebSocket(url, {headers: {Authorization: 'Bearer ' + projectA}})
      ws.on('error', () => {})
      await once(ws, 'open')
      const chunks: Buffer[] = []
      ws.on('message', data => chunks.push(Buffer.from(data as Buffer)))
      const closed = once(ws, 'close')
      ws.send(adbRequest('host:devices'), {binary: true})
      assert.equal((await closed)[0], 1000, 'Normal metadata request ' + count)
      assert.ok(Buffer.concat(chunks).includes(Buffer.from(lease.device.serial)))
    }
  })

  it('redacts storage and upstream errors from HTTP responses and status', async function() {
    const f = await fixture()
    f.failInventory()
    await f.call('/api/v1/requests', 'POST', {runId: 'queued', platform: 'Android'}, bearer,
      {'Idempotency-Key': 'queued'})
    await f.engine.tick()
    const status = await f.call('/api/v1/status')
    assert.equal(status.body.lastError, 'Farm inventory is temporarily unavailable')
    f.store.fail = true
    const failed = await f.call('/api/v1/requests', 'POST', {runId: 'fail', platform: 'Android'},
      bearer, {'Idempotency-Key': 'fail'})
    assert.equal(failed.status, 503)
    assert.doesNotMatch(JSON.stringify([status.body, failed.body]),
      new RegExp(stfToken + '|' + apiToken + '|private filesystem|stack'))
  })
  it('restricts every maintenance operation to the operator and validates JSON before draining',
    async() => {
    const f = await fixture(true, true)
    const id = '34725f38-4b42-4c84-94d8-31eb3baa2478'
    const body = {serial: 'IPHONE-A', operationId: id}
    for (const [route, method] of [['/api/v1/maintenance', 'POST']
      , ['/api/v1/maintenance/' + id, 'GET'], ['/api/v1/maintenance/' + id, 'DELETE']]) {
      assert.equal((await f.call(route!, method!, method === 'POST' ? body : undefined,
        'Bearer ' + projectA)).status, 403)
    }
    for (const value of [null, [], {}, {...body, force: true}
      , {...body, operationId: 'not-a-uuid'}, {...body, serial: 7}]) {
      assert.equal((await f.call('/api/v1/maintenance', 'POST', value)).status, 400)
      assert.deepEqual(f.store.state.maintenance, [])
    }
    assert.equal((await f.call('/api/v1/maintenance', 'POST', body)).status, 404)
    const invalid = await fetch(f.url + '/api/v1/maintenance', {method: 'POST'
      , headers: {Authorization: bearer, 'Content-Type': 'application/json'}, body: '{invalid'})
    assert.equal(invalid.status, 400)
    assert.deepEqual(f.store.state.maintenance, [])
  })

  it('sanitizes WDA metadata and verifies fresh upstream checks before reopening', async() => {
    const f = await fixture()
    const id = '34725f38-4b42-4c84-94d8-31eb3baa2478'
    const now = Date.parse('2026-10-18T00:00:00Z')
    f.devices[0] = {...f.devices[0]!, serial: 'IPHONE-A', platform: 'iOS'
      , ios: {wda: {profile: 'valid', checkedAt: new Date(now).toISOString()
        , expiresAt: new Date(now + 86400000).toISOString()}}}
    f.grid.nodes[0]!.slots[0]!.stereotype = {platformName: 'iOS', 'appium:udid': 'IPHONE-A'
      , 'appium:platformVersion': '15'}
    const route = '/api/v1/maintenance/' + id
    const started = await f.call('/api/v1/maintenance', 'POST',
      {serial: 'IPHONE-A', operationId: id})
    assert.equal(started.status, 202)
    assert.equal(started.body.maintenance.state, 'ready')
    assert.equal((await f.call(route)).body.maintenance.serial, 'IPHONE-A')
    const valid = structuredClone(f.devices[0]!.ios!)
    f.devices[0]!.ios!.wda.checkedAt = '2026-10-18'
    assert.equal((await f.backend.devices())[0]!.ios, undefined)
    assert.equal((await f.call(route, 'DELETE', {force: true})).status, 409)
    assert.equal(f.store.state.maintenance.length, 1)
    f.devices[0]!.ios = valid
    assert.equal((await f.call(route, 'DELETE')).status, 200)
    assert.equal((await f.call(route)).status, 404)
    assert.deepEqual(f.store.state.maintenance, [])
    assert.equal(f.stfCalls.filter(call => call.method !== 'GET').length, 0,
      'Maintenance API cannot capture or release STF ownership')
  })
})
