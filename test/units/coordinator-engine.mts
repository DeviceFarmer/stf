import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {Coordinator} from '../../lib/units/coordinator/engine.js'
import {BackendError} from '../../lib/units/coordinator/backend.js'
import {CoordinatorError} from '../../lib/units/coordinator/config.js'
import type {StateStore} from '../../lib/units/coordinator/state.js'
import type {
  AdbPool, AllocationInput, CaptureReconciliationInput, CoordinatorOptions, CoordinatorState
, FarmBackend, FarmDevice, GridStatus, UpstreamResponse
} from '../../lib/units/coordinator/types.js'

const owner = 'coordinator@example.test'
const initialTime = Date.parse('2026-10-18T10:00:00Z')
const maintenanceId = '34725f38-4b42-4c84-94d8-31eb3baa2478'
const otherMaintenanceId = '71b30b15-1f08-4dfb-9126-761897aa9cc0'
const freshWda = (expires = initialTime + 86400000, checked = initialTime) => ({
  profile: 'valid' as const, expiresAt: new Date(expires).toISOString()
, checkedAt: new Date(checked).toISOString()
})
const pools: AdbPool[] = [{
  provider: 'provider-one', host: 'adb-one', port: 5037, systemPorts: [8200, 8201]
}]
const options: CoordinatorOptions = {
  host: '127.0.0.1', port: 8080, publicUrl: 'http://127.0.0.1:8080'
, stfApiUrl: 'http://stf.test/api/v1', stfTokenFile: '/private/stf-token'
, apiTokenFile: '/private/api-token', appiumGridUrl: 'http://grid.test'
, stateFile: '/private/coordinator.json', adbPoolsFile: '/private/pools.json'
, leaseTtlSeconds: 10, heartbeatIntervalSeconds: 2, pollIntervalSeconds: 1
, maxDurationSeconds: 60, maxParallel: 10, upstreamTimeoutSeconds: 1
}

const input = (overrides: Partial<AllocationInput> = {}): AllocationInput => ({
  runId: 'settings-demo', platform: 'Android', queueTimeoutSeconds: 60
, maxDurationSeconds: 60, ...overrides
})
const phone = (serial: string, overrides: Partial<FarmDevice> = {}): FarmDevice => ({
  serial, platform: 'Android', model: 'Example phone', version: '15'
, provider: 'provider-one', present: true, ready: true, owner: null
, usage: null, automationLeaseId: null, ...overrides
})
const response = (status: number, value: unknown): UpstreamResponse => ({
  status, contentType: 'application/json', body: Buffer.from(JSON.stringify({value}))
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return {promise, resolve}
}
async function rejectCode(operation: Promise<unknown>, code: string, status: number) {
  await assert.rejects(operation, error => error instanceof CoordinatorError &&
    error.code === code && error.status === status)
}

class MemoryStore implements StateStore {
  state: CoordinatorState = {version: 2, maintenance: [], requests: [], leases: []}
  failWrites = false
  saves = 0
  saveBarrier: ReturnType<typeof deferred> | null = null
  saveEntered: ReturnType<typeof deferred> | null = null

  async load() {
    return structuredClone(this.state)
  }

  async save(state: CoordinatorState) {
    if (this.failWrites) {
      throw new Error('Simulated persistent storage failure')
    }
    this.saveEntered?.resolve()
    if (this.saveBarrier) {
      await this.saveBarrier.promise
    }
    this.saves++
    this.state = structuredClone(state)
  }
}

class FakeFarm implements FarmBackend {
  inventory = [phone('ANDROID-A'), phone('ANDROID-B'), phone('ANDROID-C')]
  slots: GridStatus = {ready: true, nodes: [0, 1].map(number => ({
    id: 'android-node-' + number, availability: 'UP'
  , slots: [{stereotype: {platformName: 'Android', 'appium:remoteAdbHost': 'adb-one'}
      , session: null}]
  }))}
  events: string[] = []
  webdriverCalls: {method: string, route: string, body?: unknown}[] = []
  captures: {serial: string, leaseId: string, timeout: number}[] = []
  inventoryError = false
  inventoryBarrier: ReturnType<typeof deferred> | null = null
  inventoryEntered: ReturnType<typeof deferred> | null = null
  renewBarrier: ReturnType<typeof deferred> | null = null
  renewEntered: ReturnType<typeof deferred> | null = null
  captureError: Error | null = null
  captureBarrier: ReturnType<typeof deferred> | null = null
  captureEntered: ReturnType<typeof deferred> | null = null
  commandBarrier: ReturnType<typeof deferred> | null = null
  commandEntered: ReturnType<typeof deferred> | null = null
  commandError = false
  createError = false
  createErrorAfterSession = false
  malformedCreate = false
  createStatus = 200
  deleteStatus = 200
  retainDeletedSession = false
  sessionCounter = 0
  gridError = false
  gridCalls = 0
  maestroCleanupError = false
  baselineSaved: (() => void) | null = null
  maestroLeases = new Set<string>()
  maestroReceipts = new Map<string, string>()

  async maestroBaseline(device: FarmDevice) {
    this.events.push('maestro-baseline:' + device.serial)
    return {packages: [], settings: {'system/accelerometer_rotation': '0'}}
  }

  async maestroPrepare(device: FarmDevice) {
    this.baselineSaved?.()
    this.events.push('maestro-prepare:' + device.serial)
  }

  async maestroCleanup(device: FarmDevice) {
    this.events.push('maestro-cleanup:' + device.serial)
    if (this.maestroCleanupError) {
 throw new Error('Driver did not stop')
}
  }

  async identity() {
    return {email: owner}
  }

  async devices() {
    this.inventoryEntered?.resolve()
    if (this.inventoryBarrier) {
      await this.inventoryBarrier.promise
    }
    if (this.inventoryError) {
      throw new Error('Inventory unavailable')
    }
    return structuredClone(this.inventory)
  }

  async grid() {
    this.gridCalls++
    if (this.gridError) {
 throw new Error('Grid unavailable')
}
    return structuredClone(this.slots)
  }

  async capture(serial: string, leaseId: string, timeout: number, runner?: string) {
    if (runner === 'maestro') {
 this.maestroLeases.add(leaseId)
}
    this.events.push('capture:' + serial)
    this.captureEntered?.resolve()
    if (this.captureBarrier) {
      await this.captureBarrier.promise
    }
    if (this.captureError) {
      throw this.captureError
    }
    const device = this.inventory.find(item => item.serial === serial)!
    if (device.owner) {
      throw new BackendError(409, 'capture')
    }
    device.owner = {email: owner}
    device.usage = 'automation'
    device.automationLeaseId = leaseId
    this.captures.push({serial, leaseId, timeout})
  }

  async renew(serial: string, leaseId: string) {
    this.events.push('renew:' + serial)
    this.renewEntered?.resolve()
    if (this.renewBarrier) {
      await this.renewBarrier.promise
    }
    const device = this.inventory.find(item => item.serial === serial)!
    if (device.owner?.email !== owner || device.automationLeaseId !== leaseId) {
      throw new BackendError(409, 'renew')
    }
  }

  async release(serial: string, leaseId: string) {
    const device = this.inventory.find(item => item.serial === serial)!
    if (device.owner?.email !== owner || device.automationLeaseId !== leaseId) {
      if (this.maestroReceipts.get(serial) === leaseId) {
        this.events.push('receipt:' + serial)
        return
      }
      throw new BackendError(409, 'release')
    }
    if (this.maestroLeases.has(leaseId)) {
      await this.maestroCleanup(device)
      this.maestroReceipts.set(serial, leaseId)
    }
    this.events.push('release:' + serial)
    device.owner = null
    device.usage = null
    device.automationLeaseId = null
  }

  async webdriver(method: string, route: string, body?: unknown) {
    this.events.push('webdriver:' + method + ':' + route)
    this.webdriverCalls.push({method, route, ...(body ? {body} : {})})
    if (method === 'POST' && route === '/session') {
      if (this.createError) {
        throw new Error('Network failed after upstream may have created a session')
      }
      if (this.malformedCreate) {
        return {status: 200, contentType: 'application/json', body: Buffer.from('invalid-json')}
      }
      if (this.createStatus !== 200) {
        return response(this.createStatus, {error: 'unknown error', message: 'Backend failed'})
      }
      const capabilities = (body as {capabilities: {alwaysMatch: Record<string, unknown>}})
        .capabilities.alwaysMatch
      const slot = this.slots.nodes.flatMap(node => node.slots).find(item => !item.session)!
      const sessionId = 'session-' + (++this.sessionCounter)
      slot.session = {sessionId, capabilities: structuredClone(capabilities)}
      if (this.createErrorAfterSession) {
        throw new Error('Response lost after creating the upstream session')
      }
      return response(200, {sessionId, capabilities})
    }
    if (method === 'DELETE' && route.startsWith('/session/')) {
      if (this.deleteStatus === 200 && !this.retainDeletedSession) {
        const sessionId = decodeURIComponent(route.split('/')[2]!)
        const slot = this.slots.nodes.flatMap(node => node.slots)
          .find(item => item.session?.sessionId === sessionId)
        if (slot) {
          slot.session = null
        }
      }
      return response(this.deleteStatus, null)
    }
    this.commandEntered?.resolve()
    if (this.commandBarrier) {
      await this.commandBarrier.promise
    }
    if (this.commandError) {
      throw new Error('WebDriver command outcome is unknown')
    }
    return response(200, null)
  }
}

async function fixture(settings: Partial<CoordinatorOptions> = {}, farm = new FakeFarm(),
  store = new MemoryStore(), poolConfig = pools) {
  let time = initialTime
  const config = {...options, ...settings}
  const engine = new Coordinator(config, poolConfig, farm, store, () => time)
  await engine.start()
  const allocate = async(overrides: Partial<AllocationInput> = {}, key = 'request-one') => {
    const request = await engine.submit(input(overrides), key)
    await engine.tick()
    const allocated = engine.requestView(request.id)
    assert.ok(allocated.leaseId, 'Expected a granted lease')
    return engine.leaseView(allocated.leaseId)
  }
  const create = async(id: string, capabilities: Record<string, unknown> = {}) => {
    await engine.webdriver(id, 'POST', '/session', {
      capabilities: {alwaysMatch: capabilities, firstMatch: [{}]}
    })
    const lease = engine.leaseView(id)
    assert.ok(lease.sessionId)
    return lease.sessionId
  }
  return {engine, farm, store, config, allocate, create, advance(ms: number) {
    time += ms
  }, now: () => time}
}

describe('coordinator allocation and lifetime', () => {
  it('rejects unknown projects before persisting or capturing devices', async() => {
    const {engine, farm, store} = await fixture()
    engine.setProjectLimits(new Map([['enabled-project', 1]]))
    await assert.rejects(engine.submit(input(), 'unknown-project-request', 'removed-project'),
      error => error instanceof CoordinatorError && error.status === 403)
    assert.equal(store.state.requests.length, 0)
    assert.equal(farm.captures.length, 0)
  })

  it('fails disabled queued projects after restart and schedules enabled projects', async() => {
    const original = await fixture()
    original.engine.setProjectLimits(new Map([['removed-project', 1], ['enabled-project', 1]]))
    const removed = await original.engine.submit(input({serial: 'ANDROID-A'}),
      'same-key', 'removed-project')
    const enabled = await original.engine.submit(input({serial: 'ANDROID-B'}),
      'same-key', 'enabled-project')
    const restarted = new Coordinator(original.config, pools, original.farm,
      original.store, original.now)
    restarted.setProjectLimits(new Map([['enabled-project', 1]]))
    await restarted.start()
    await restarted.tick()
    assert.equal(restarted.requestView(removed.id).state, 'failed')
    assert.equal(restarted.requestView(removed.id).error, 'project_disabled')
    assert.equal(restarted.requestView(removed.id).leaseId, undefined)
    assert.equal(restarted.requestView(enabled.id).state, 'allocated')
    assert.deepEqual(original.farm.captures.map(item => item.serial), ['ANDROID-B'])
  })

  it('makes repeated submissions idempotent and rejects a changed payload', async() => {
    const {engine, farm} = await fixture()
    const first = await engine.submit(input(), 'worker-1')
    const again = await engine.submit(input(), 'worker-1')
    assert.deepEqual(again, first)
    await rejectCode(engine.submit(input({serial: 'OTHER'}), 'worker-1'),
      'idempotency_conflict', 409)
    await engine.tick()
    assert.equal(farm.captures.length, 1)
  })

  it('prunes only resolved requests and terminal leases after the idempotency window',
    async() => {
      const {engine, allocate, advance, store} = await fixture()
      const first = await allocate({serial: 'ANDROID-A'}, 'history')
      await engine.release(first.id)
      await engine.tick()
      const queued = await engine.submit(input({serial: 'missing'}), 'queued')
      const held = await allocate({serial: 'ANDROID-B'}, 'held')

      const window = 7 * 24 * 60 * 60 * 1000
      advance(window - 1)
      const retry = await engine.submit(input({serial: 'ANDROID-A'}), 'history')
      assert.equal(retry.id, first.requestId)
      assert.equal(engine.leaseView(first.id).state, 'released')

      advance(1)
      const newRequest = await engine.submit(input({serial: 'ANDROID-A'}), 'history')
      assert.notEqual(newRequest.id, first.requestId)
      assert.throws(() => engine.requestView(first.requestId), {code: 'request_not_found'})
      assert.throws(() => engine.leaseView(first.id), {code: 'lease_not_found'})
      assert.equal(engine.requestView(queued.id).state, 'queued')
      assert.equal(engine.leaseView(held.id).state, 'active')
      assert.ok(store.state.leases.every(lease =>
        store.state.requests.some(request => request.id === lease.requestId)))
    })

  it('enforces admission limits independently for each project', async() => {
    const store = new MemoryStore()
    store.state.requests = Array.from({length: 10000}, (_, index) => ({
      id: 'past-' + index, key: 'key-' + index, fingerprint: 'fixture', projectId: 'first'
    , input: input(), state: 'cancelled', createdAt: initialTime, queueDeadlineAt: initialTime
    }))
    const {engine} = await fixture({}, new FakeFarm(), store)
    engine.setProjectLimits(new Map([['first', 1], ['second', 1]]))
    await rejectCode(engine.submit(input(), 'extra', 'first'), 'queue_limit', 429)
    const other = await engine.submit(input(), 'extra', 'second')
    assert.equal(other.state, 'queued')
    assert.equal(other.projectId, 'second')
  })

  it('skips an unavailable oldest request and allocates matching requests in order', async() => {
    const {engine, farm} = await fixture()
    const blocked = await engine.submit(input({model: 'Unavailable model'}), 'blocked')
    const first = await engine.submit(input(), 'first')
    const second = await engine.submit(input(), 'second')
    const third = await engine.submit(input(), 'third')
    await engine.tick()
    assert.equal(engine.requestView(blocked.id).state, 'queued')
    assert.equal(engine.requestView(first.id).state, 'allocated')
    assert.equal(engine.requestView(second.id).state, 'allocated')
    assert.equal(engine.requestView(third.id).state, 'queued')
    assert.deepEqual(farm.captures.map(item => item.serial), ['ANDROID-A', 'ANDROID-B'])
    const ports = engine.leasesView().map(lease => lease.capabilities['appium:systemPort'])
    assert.deepEqual(ports, [8200, 8201])
  })

  it('never captures a manual user phone or issues one serial twice', async() => {
    const farm = new FakeFarm()
    farm.inventory[0]!.owner = {email: 'manual@example.test'}
    const {engine} = await fixture({}, farm)
    await Promise.all([engine.submit(input({serial: 'ANDROID-B'}), 'one')
    , engine.submit(input({serial: 'ANDROID-B'}), 'two')])
    await Promise.all([engine.tick(), engine.tick()])
    assert.deepEqual(farm.captures.map(item => item.serial), ['ANDROID-B'])
    assert.equal(farm.inventory[0]!.owner?.email, 'manual@example.test')
    assert.equal(engine.leasesView().length, 1)
  })

  it('respects parallel limits, remote ADB occupied ports and queue expiry', async() => {
    const farm = new FakeFarm()
    farm.slots.nodes.push({id: 'external', availability: 'UP', slots: [{
      stereotype: {platformName: 'Android', 'appium:remoteAdbHost': 'adb-one'}
    , session: {sessionId: 'external-session', capabilities: {
        'appium:remoteAdbHost': 'adb-one', 'appium:systemPort': 8200
      }}
    }]})
    const {engine, allocate, advance} = await fixture({maxParallel: 1}, farm)
    const lease = await allocate()
    assert.equal(lease.capabilities['appium:systemPort'], 8201)
    const waiting = await engine.submit(input({queueTimeoutSeconds: 1}), 'waiting')
    advance(1000)
    await engine.tick()
    assert.equal(engine.requestView(waiting.id).state, 'expired')
    assert.equal(farm.captures.length, 1)
  })

  it('renews until the deadline and quits before releasing expired ownership', async() => {
    const {engine, allocate, create, advance, farm, now} = await fixture()
    const lease = await allocate({maxDurationSeconds: 12})
    await create(lease.id)
    advance(7000)
    const renewed = await engine.renew(lease.id)
    assert.equal(Date.parse(renewed.expiresAt), initialTime + 12000)
    assert.ok(farm.captures[0]!.timeout > options.leaseTtlSeconds * 1000)
    advance(5000)
    assert.equal(now(), initialTime + 12000)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'expired')
    const deleted = farm.events.indexOf('webdriver:DELETE:/session/session-1')
    const released = farm.events.indexOf('release:ANDROID-A')
    assert.ok(deleted >= 0 && released > deleted, 'Quit must precede STF release')
    await rejectCode(engine.renew(lease.id), 'lease_inactive', 409)
  })

  it('expires worker heartbeat despite coordinator-side STF renewal', async() => {
    const {engine, allocate, advance, farm} = await fixture()
    const lease = await allocate()
    advance(3000)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'active')
    advance(7000)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'expired')
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('cleans an allocation completed concurrently with request cancellation', async() => {
    const farm = new FakeFarm()
    farm.captureBarrier = deferred()
    farm.captureEntered = deferred()
    const {engine} = await fixture({}, farm)
    const request = await engine.submit(input(), 'cancel-during-capture')
    const scheduling = engine.tick()
    await farm.captureEntered.promise
    const cancellation = engine.cancel(request.id)
    farm.captureBarrier.resolve()
    await scheduling
    await cancellation
    await engine.tick()
    const cancelled = engine.requestView(request.id)
    assert.equal(cancelled.state, 'cancelled')
    assert.ok(cancelled.leaseId)
    assert.equal(engine.leaseView(cancelled.leaseId).state, 'released')
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('renews an active worker beyond its original TTL during another capture', async() => {
    const {engine, allocate, create, farm, advance} = await fixture()
    const active = await allocate({}, 'active-worker')
    farm.captureBarrier = deferred()
    farm.captureEntered = deferred()
    await engine.submit(input(), 'slow-capture')
    const scheduling = engine.tick()
    await farm.captureEntered.promise
    try {
      advance(9000)
      const renewed = await Promise.race([engine.renew(active.id)
        , new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Heartbeat blocked behind another capture')), 1000)
        })])
      assert.equal(Date.parse(renewed.expiresAt), initialTime + 19000)
      advance(2000)
      await create(active.id)
      assert.equal(engine.leaseView(active.id).state, 'active')
    }
    finally {
      farm.captureBarrier.resolve()
      await scheduling
    }
  })

  it('does not forward a command when cancellation wins during its STF fence check', async() => {
    const {engine, allocate, create, farm} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.renewBarrier = deferred()
    farm.renewEntered = deferred()
    const command = engine.webdriver(lease.id, 'GET', '/session/' + session + '/source')
    const outcome = command.catch(error => error)
    await farm.renewEntered.promise
    try {
      await engine.release(lease.id)
      await engine.tick()
      assert.equal(engine.leaseView(lease.id).state, 'released')
    }
    finally {
      farm.renewBarrier.resolve()
    }
    assert.ok(await outcome instanceof CoordinatorError)
    assert.equal(farm.webdriverCalls.some(call => call.route.endsWith('/source')), false)
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('does not revive a stopped allocation after a late capture response', async() => {
    const farm = new FakeFarm()
    farm.captureBarrier = deferred()
    farm.captureEntered = deferred()
    const {engine} = await fixture({}, farm)
    const request = await engine.submit(input(), 'stop-during-capture')
    const scheduling = engine.tick()
    await farm.captureEntered.promise
    const stopping = engine.stop()
    farm.captureBarrier.resolve()
    await Promise.all([scheduling, stopping])
    const lease = engine.leaseView(engine.requestView(request.id).leaseId!)
    assert.equal(lease.state, 'expired')
    assert.equal(engine.ready, false)
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('preserves queued requests and cleans old sessions after restart', async() => {
    const original = await fixture()
    const lease = await original.allocate()
    await original.create(lease.id)
    const queued = await original.engine.submit(input({model: 'Unavailable'}), 'queued')
    const replacement = new Coordinator(original.config, pools, original.farm,
      original.store, original.now)
    await replacement.start()
    assert.equal(replacement.requestView(queued.id).state, 'queued')
    assert.equal(replacement.leaseView(lease.id).state, 'expired')
    assert.equal(original.farm.inventory[0]!.owner, null)
    assert.equal(original.farm.slots.nodes[0]!.slots[0]!.session, null)
  })

  it('leaves requests queued when inventory fails and resumes after recovery', async() => {
    const {engine, farm} = await fixture()
    const request = await engine.submit(input(), 'inventory-outage')
    farm.inventoryError = true
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'queued')
    assert.equal(farm.captures.length, 0)
    assert.ok(engine.status().lastError)
    farm.inventoryError = false
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'allocated')
  })

  it('stops allocations and commands after durable state writes fail', async() => {
    const {engine, store, farm} = await fixture()
    const request = await engine.submit(input(), 'disk-failure')
    store.failWrites = true
    await rejectCode(engine.tick(), 'state_unavailable', 503)
    assert.equal(farm.captures.length, 0, 'No capture may happen before durable allocation')
    assert.equal(engine.ready, false)
    await rejectCode(engine.submit(input(), 'another'), 'not_ready', 503)
    assert.equal(engine.requestView(request.id).state, 'queued')
  })

  it('rejects an expired heartbeat immediately before the scheduler notices expiry', async() => {
    const {engine, allocate, advance} = await fixture()
    const lease = await allocate()
    advance(10000)
    await rejectCode(engine.renew(lease.id), 'lease_inactive', 409)
  })

  it('rejects new commands if saving a heartbeat fails for an existing session', async() => {
    const {engine, allocate, create, store, farm} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    store.failWrites = true
    await rejectCode(engine.renew(lease.id), 'state_unavailable', 503)
    const before = farm.webdriverCalls.length
    await rejectCode(engine.webdriver(lease.id, 'GET', '/session/' + session + '/source'),
      'not_ready', 503)
    assert.equal(farm.webdriverCalls.length, before)
  })

  it('preserves a manual capture that wins the STF reservation race', async() => {
    const farm = new FakeFarm()
    farm.captureBarrier = deferred()
    farm.captureEntered = deferred()
    const {engine} = await fixture({}, farm)
    const request = await engine.submit(input({serial: 'ANDROID-A'}), 'manual-race')
    const scheduling = engine.tick()
    await farm.captureEntered.promise
    farm.inventory[0]!.owner = {email: 'manual@example.test'}
    farm.captureBarrier.resolve()
    await scheduling
    assert.equal(engine.requestView(request.id).state, 'queued')
    assert.equal(farm.inventory[0]!.owner.email, 'manual@example.test')
    assert.equal(farm.events.some(event => event.startsWith('release:')), false)
  })

  it('allows the same system port on distinct remote ADB hosts', async() => {
    const farm = new FakeFarm()
    farm.inventory[1]!.provider = 'provider-two'
    farm.slots.nodes[1]!.slots[0]!.stereotype['appium:remoteAdbHost'] = 'adb-two'
    const separate = [
      {...pools[0]!, systemPorts: [8200]}
    , {provider: 'provider-two', host: 'adb-two', port: 5037, systemPorts: [8200]}
    ]
    const {engine} = await fixture({}, farm, new MemoryStore(), separate)
    await engine.submit(input(), 'one')
    await engine.submit(input(), 'two')
    await engine.tick()
    const leases = engine.leasesView()
    assert.equal(leases.length, 2)
    assert.deepEqual(leases.map(lease => lease.capabilities['appium:systemPort']), [8200, 8200])
    assert.deepEqual(leases.map(lease => lease.capabilities['appium:remoteAdbHost']),
      ['adb-one', 'adb-two'])
  })

  it('requires unambiguous Appium Grid routes for ADB pools sharing a hostname', async() => {
    const farm = new FakeFarm()
    farm.inventory[1]!.provider = 'provider-two'
    const [first, second] = farm.slots.nodes.map(node => node.slots[0]!.stereotype)
    first!['appium:adbPort'] = 5037
    second!['appium:adbPort'] = 5037
    const separate = [pools[0]!, {
      provider: 'provider-two', host: 'adb-one', port: 5038, systemPorts: [8202]
    }]
    const {engine} = await fixture({}, farm, new MemoryStore(), separate)
    const request = await engine.submit(input({provider: 'provider-two'}), 'other-adb-port')
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'queued')

    second!['appium:adbPort'] = 5038
    delete first!['appium:adbPort']
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'queued')

    first!['appium:adbPort'] = 5037
    await engine.tick()
    const leaseId = engine.requestView(request.id).leaseId
    assert.ok(leaseId)
    assert.equal(engine.leaseView(leaseId).capabilities['appium:adbPort'], 5038)
  })

  it('requires an exact UP iOS relay with the current OS version', async() => {
    const farm = new FakeFarm()
    farm.inventory = [phone('IPHONE-A', {platform: 'iOS', version: '27.0.1'
      , ios: {wda: freshWda()}})]
    farm.slots.nodes = [{id: 'ios-node', availability: 'UP', slots: [{
      stereotype: {platformName: 'iOS', 'appium:udid': 'IPHONE-A'
        , 'appium:platformVersion': '26.7.1'}, session: null
    }]}]
    const {engine} = await fixture({}, farm)
    const request = await engine.submit(input({platform: 'iOS'}), 'ios')
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'queued')
    farm.slots.nodes[0]!.slots[0]!.stereotype['appium:platformVersion'] = '27.0.1'
    await engine.tick()
    const allocated = engine.requestView(request.id)
    assert.ok(allocated.leaseId)
    const lease = engine.leaseView(allocated.leaseId)
    assert.equal(lease.capabilities['appium:platformVersion'], '27.0.1')
    assert.equal(Object.hasOwn(lease.capabilities, 'appium:systemPort'), false)
  })
})

describe('coordinator session isolation and uncertain cleanup', () => {
  it('uses authoritative capabilities and blocks conflicting connection overrides', async() => {
    const {engine, allocate, create, farm} = await fixture()
    const lease = await allocate()
    for (const conflict of [
      {'appium:udid': 'OTHER'}, {'appium:systemPort': 9999}
    , {'appium:remoteAdbHost': 'other-adb'}, {'appium:newCommandTimeout': 0}
    , {'appium:suppressKillServer': false}, {suppressKillServer: false}
    , {platformName: 'iOS'}, {'appium:webDriverAgentUrl': 'http://another-phone'}
    ]) {
      await rejectCode(engine.webdriver(lease.id, 'POST', '/session', {
        capabilities: {alwaysMatch: conflict}
      }), 'capability_conflict', 409)
    }
    assert.equal(farm.webdriverCalls.length, 0)
    await create(lease.id, {'appium:appPackage': 'example.app'})
    const body = farm.webdriverCalls[0]!.body as {
      capabilities: {alwaysMatch: Record<string, unknown>}
    }
    assert.equal(body.capabilities.alwaysMatch['appium:systemPort'], 8200)
    assert.equal(body.capabilities.alwaysMatch['appium:suppressKillServer'], true)
    assert.equal(body.capabilities.alwaysMatch['appium:udid'], 'ANDROID-A')
    assert.equal(body.capabilities.alwaysMatch['stf:leaseId'], lease.id)
    assert.equal(body.capabilities.alwaysMatch['appium:appPackage'], 'example.app')
  })

  it('accepts Java-client platformName casing and retains canonical capabilities', async() => {
    for (const platform of ['Android', 'iOS'] as const) {
      const farm = new FakeFarm()
      farm.inventory = [phone('PHONE-A', {platform, version: '27.0'
        , ...(platform === 'iOS' ? {ios: {wda: freshWda()}} : {})})]
      farm.slots.nodes = [{id: 'node', availability: 'UP', slots: [{session: null
        , stereotype: {platformName: platform, 'appium:remoteAdbHost': 'adb-one'
          , 'appium:udid': 'PHONE-A', 'appium:platformVersion': '27.0'}}]}]
      const {allocate, create} = await fixture({}, farm)
      const lease = await allocate({platform})
      await create(lease.id, {platformName: platform.toUpperCase()})
      const body = farm.webdriverCalls[0]!.body as {capabilities: {
        alwaysMatch: Record<string, unknown>}}
      assert.equal(body.capabilities.alwaysMatch.platformName, platform)
    }
  })

  it('rejects commands addressed to another lease session', async() => {
    const {engine, allocate, create, farm} = await fixture()
    const first = await allocate({}, 'first')
    const second = await allocate({}, 'second')
    const firstSession = await create(first.id)
    const secondSession = await create(second.id)
    const callsBefore = farm.webdriverCalls.length
    await rejectCode(engine.webdriver(first.id, 'GET', '/session/' + secondSession + '/source'),
      'session_not_found', 404)
    assert.equal(farm.webdriverCalls.length, callsBefore)
    await engine.webdriver(first.id, 'GET', '/session/' + firstSession + '/source')
    assert.equal(farm.webdriverCalls.length, callsBefore + 1)
  })

  it('rejects nested and malformed W3C capabilities without upstream side effects', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    for (const body of [
      {desiredCapabilities: {'appium:udid': 'OTHER'}}
    , {capabilities: {alwaysMatch: {'appium:options': {udid: 'OTHER'}}}}
    , {capabilities: {alwaysMatch: [], firstMatch: [{}]}}
    , {capabilities: {alwaysMatch: {}, firstMatch: [null]}}
    , {capabilities: {alwaysMatch: {}, firstMatch: [{}, {}]}}
    , {capabilities: {alwaysMatch: {}, firstMatch: []}}
    ]) {
      await assert.rejects(engine.webdriver(lease.id, 'POST', '/session', body))
      assert.equal(farm.webdriverCalls.length, 0)
      assert.equal(engine.leaseView(lease.id).state, 'active')
    }
  })

  it('rejects path traversal before it can be normalized into another session', async() => {
    const {engine, allocate, create, farm} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    for (const suffix of [
      '/../../session/OTHER/source', '/%2e%2e/%2e%2e/session/OTHER/source'
    , '/..%2f..%2fsession%2fOTHER%2fsource', '/..\\..\\session\\OTHER\\source'
    ]) {
      const before = farm.webdriverCalls.length
      await assert.rejects(engine.webdriver(lease.id, 'GET', '/session/' + session + suffix))
      assert.equal(farm.webdriverCalls.length, before, 'Unsafe route must not reach Grid')
    }
  })

  it('quarantines an unknown create outcome and keeps the phone and port reserved', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    farm.createError = true
    await rejectCode(engine.webdriver(lease.id, 'POST', '/session', {
      capabilities: {alwaysMatch: {}}
    }), 'upstream_unknown', 502)
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    const queued = await engine.submit(input({serial: lease.device.serial}), 'waiting')
    await engine.tick()
    assert.equal(engine.requestView(queued.id).state, 'queued')
    assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
    assert.equal(farm.events.some(event => event.startsWith('release:')), false)
  })

  it('never releases ownership after failed or unconfirmed Appium deletion', async() => {
    for (const failure of ['delete-error', 'still-in-grid']) {
      const {engine, allocate, create, farm} = await fixture()
      const lease = await allocate()
      await create(lease.id)
      farm.deleteStatus = failure === 'delete-error' ? 500 : 200
      farm.retainDeletedSession = failure === 'still-in-grid'
      await engine.release(lease.id)
      await engine.tick()
      assert.equal(engine.leaseView(lease.id).state, 'quarantined')
      assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
      assert.equal(farm.events.some(event => event.startsWith('release:')), false)
      farm.deleteStatus = 200
      farm.retainDeletedSession = false
      await engine.recover(lease.id)
      assert.equal(engine.leaseView(lease.id).state, 'released')
    }
  })

  it('quarantines a router 404 when the original Appium node is missing from Grid', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    const originalNode = farm.slots.nodes.shift()!
    assert.equal(originalNode.slots[0]!.session?.sessionId, session)
    assert.equal(store.state.leases[0]?.appiumNodeId, originalNode.id)
    assert.equal(farm.slots.nodes[0]?.availability, 'UP')
    farm.deleteStatus = 404

    await engine.release(lease.id)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(engine.leaseView(lease.id).sessionId, session)
    assert.equal(farm.inventory[0]?.automationLeaseId, lease.id)
    assert.ok(!farm.events.includes('release:ANDROID-A'))

    originalNode.slots[0]!.session = null
    farm.slots.nodes.push(originalNode)
    await engine.recover(lease.id)
    assert.equal(engine.leaseView(lease.id).state, 'released')
    assert.equal(store.state.leases[0]?.appiumNodeId, undefined)
  })

  it('keeps preexisting sessions fenced on a router 404 without a saved Grid node', async() => {
    const {allocate, create, farm, store, config} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    delete store.state.leases[0]!.appiumNodeId
    farm.deleteStatus = 404
    farm.slots.nodes[0]!.slots[0]!.session = null
    const restarted = new Coordinator(config, pools, farm, store, () => initialTime)
    await restarted.start()
    assert.equal(restarted.leaseView(lease.id).state, 'quarantined')
    assert.equal(restarted.leaseView(lease.id).sessionId, session)
    assert.equal(farm.inventory[0]?.automationLeaseId, lease.id)
  })

  it('waits for a busy Grid to retire the deleted Appium session before releasing STF', async() => {
    const {engine, allocate, create, farm} = await fixture()
    const lease = await allocate()
    await create(lease.id)
    farm.retainDeletedSession = true
    farm.slots.ready = false
    let observations = 0
    const readGrid = farm.grid.bind(farm)
    farm.grid = async({allowBusy = false}: {allowBusy?: boolean} = {}) => {
      assert.equal(allowBusy, true)
      observations++
      assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
      if (observations === 2) {
        farm.slots.nodes[0]!.slots[0]!.session = null
      }
      return readGrid()
    }
    await engine.release(lease.id)
    await engine.tick()
    assert.equal(observations, 2)
    assert.equal(engine.leaseView(lease.id).state, 'released')
  })

  it('confirms an explicit WebDriver DELETE before accepting a new session', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.retainDeletedSession = true
    farm.slots.ready = false
    let observations = 0
    const readGrid = farm.grid.bind(farm)
    farm.grid = async({allowBusy = false}: {allowBusy?: boolean} = {}) => {
      assert.equal(allowBusy, true)
      assert.equal(store.state.leases[0]!.sessionId, session)
      if (++observations === 2) {
        farm.slots.nodes[0]!.slots[0]!.session = null
      }
      return readGrid()
    }
    const closed = await engine.webdriver(lease.id, 'DELETE', '/session/' + session)
    assert.equal(closed.status, 200)
    assert.equal(observations, 2)
    assert.equal(store.state.leases[0]!.sessionId, undefined)
    assert.notEqual(await create(lease.id), session)
  })

  it('waits for an explicit session close before releasing the device', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    const observing = deferred()
    const retired = deferred()
    const readGrid = farm.grid.bind(farm)
    farm.grid = async() => {
      observing.resolve()
      await retired.promise
      return readGrid()
    }
    const route = '/session/' + session
    const closing = engine.webdriver(lease.id, 'DELETE', route).catch(error => error)
    await observing.promise
    try {
      await engine.release(lease.id)
      await engine.tick()
      assert.equal(engine.leaseView(lease.id).state, 'cleaning')
      assert.equal(store.state.leases[0]!.sessionId, session)
      assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
      assert.equal(farm.webdriverCalls.filter(call => call.method === 'DELETE' &&
        call.route === route).length, 1)
    }
    finally {
      retired.resolve()
    }
    assert.ok(await closing instanceof CoordinatorError)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'released')
    assert.equal(farm.inventory[0]!.owner, null)
    assert.equal(farm.webdriverCalls.filter(call => call.method === 'DELETE' &&
      call.route === route).length, 1)
  })

  it('retains the session for recovery when explicit close cannot be confirmed', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.gridError = true
    await rejectCode(engine.webdriver(lease.id, 'DELETE', '/session/' + session),
      'upstream_unknown', 502)
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(store.state.leases[0]!.sessionId, session)
    assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
    farm.gridError = false
    farm.deleteStatus = 404
    await engine.recover(lease.id)
    assert.equal(engine.leaseView(lease.id).state, 'expired')
    assert.equal(store.state.leases[0]!.sessionId, undefined)
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('recovers a failed command after confirming termination of its known session', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.commandError = true
    await rejectCode(engine.webdriver(lease.id, 'GET', '/session/' + session + '/source'),
      'upstream_unknown', 502)
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(store.state.leases[0]!.commandInFlight, true)
    await engine.recover(lease.id)
    assert.equal(engine.leaseView(lease.id).state, 'expired')
    assert.equal(store.state.leases[0]!.commandInFlight, undefined)
    assert.equal(store.state.leases[0]!.sessionId, undefined)
    assert.equal(farm.inventory[0]!.owner, null)
    const deleted = farm.events.indexOf('webdriver:DELETE:/session/' + session)
    assert.ok(deleted >= 0 && farm.events.indexOf('release:ANDROID-A') > deleted)
  })

  it('retains the known session until a cancelled in-flight command has settled', async() => {
    const {engine, allocate, create, farm, store} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.commandBarrier = deferred()
    farm.commandEntered = deferred()
    const command = engine.webdriver(lease.id, 'GET', '/session/' + session + '/source')
    const settled = command.catch(error => error)
    await farm.commandEntered.promise
    try {
      await engine.release(lease.id)
      await engine.tick()
      assert.equal(engine.leaseView(lease.id).state, 'cleaning')
      assert.equal(store.state.leases[0]!.sessionId, session,
        'Keep the SID so a late command failure cannot erase termination evidence')
      assert.equal(store.state.leases[0]!.commandInFlight, true)
      assert.ok(!farm.events.includes('release:ANDROID-A'))
      farm.commandError = true
    }
    finally {
      farm.commandBarrier.resolve()
    }
    assert.ok(await settled instanceof CoordinatorError)
    await engine.recover(lease.id)
    assert.equal(engine.leaseView(lease.id).state, 'released')
    assert.equal(store.state.leases[0]!.commandInFlight, undefined)
    assert.equal(farm.inventory[0]!.owner, null)
    assert.equal(farm.events.filter(event =>
      event === 'webdriver:DELETE:/session/' + session).length, 2)
  })

  it('keeps an uncertain command quarantined when no session identity was preserved', async() => {
    const {engine, allocate, create, farm, store, config, now} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.commandError = true
    await rejectCode(engine.webdriver(lease.id, 'GET', '/session/' + session + '/source'),
      'upstream_unknown', 502)
    // Recovery of an older durable record must not invent proof from an empty marker.
    delete store.state.leases[0]!.sessionId
    const restarted = new Coordinator(config, pools, farm, store, now)
    await restarted.start()
    assert.equal(restarted.leaseView(lease.id).state, 'quarantined')
    assert.equal(store.state.leases[0]!.commandInFlight, true)
    assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
    assert.ok(!farm.events.includes('release:ANDROID-A'))
  })

  it('holds the phone while a previously accepted command is still running', async() => {
    const {engine, allocate, create, farm, advance} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.commandBarrier = deferred()
    farm.commandEntered = deferred()
    const pending = engine.webdriver(lease.id, 'POST', '/session/' + session + '/click', {})
    const settled = pending.catch(() => {})
    await farm.commandEntered.promise
    try {
      advance(10000)
      await engine.tick()
      assert.equal(farm.inventory[0]!.automationLeaseId, lease.id,
        'Device cannot be released while an old command is unsettled')
      assert.equal(farm.events.some(event => event.startsWith('release:')), false)
      const waiting = await engine.submit(input({serial: lease.device.serial}), 'next-worker')
      await engine.tick()
      assert.equal(engine.requestView(waiting.id).state, 'queued')
    }
    finally {
      farm.commandBarrier.resolve()
      await settled
    }
    if (engine.leaseView(lease.id).state === 'quarantined') {
      await engine.recover(lease.id)
    }
    else {
      await engine.tick()
    }
    assert.equal(engine.leaseView(lease.id).state, 'expired')
  })

  it('keeps renewing STF ownership while cleanup waits for an accepted command', async() => {
    const {engine, allocate, create, farm, advance} = await fixture()
    const lease = await allocate()
    const session = await create(lease.id)
    farm.commandBarrier = deferred()
    farm.commandEntered = deferred()
    const command = engine.webdriver(lease.id, 'POST', '/session/' + session + '/click', {})
    const settled = command.catch(() => {})
    await farm.commandEntered.promise
    await engine.release(lease.id)
    const renewals = () => farm.events.filter(event => event === 'renew:ANDROID-A').length
    const before = renewals()
    try {
      for (let tick = 1; tick <= 2; tick++) {
        advance(2000)
        await engine.tick()
        assert.equal(engine.leaseView(lease.id).state, 'cleaning')
        assert.equal(farm.inventory[0]!.automationLeaseId, lease.id)
        assert.equal(renewals(), before + tick,
          'Cleanup must not disable renewal of the STF fence')
      }
      assert.equal(farm.events.some(event => event.startsWith('release:')), false)
    }
    finally {
      farm.commandBarrier.resolve()
      await settled
    }
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'released')
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('recovers the exact tagged session when its creation response was lost', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    farm.createErrorAfterSession = true
    await rejectCode(engine.webdriver(lease.id, 'POST', '/session', {
      capabilities: {alwaysMatch: {}}
    }), 'upstream_unknown', 502)
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    const upstream = farm.slots.nodes[0]!.slots[0]!.session!
    assert.equal(upstream.capabilities['stf:leaseId'], lease.id)
    await engine.recover(lease.id)
    assert.equal(engine.leaseView(lease.id).state, 'expired')
    assert.equal(farm.slots.nodes[0]!.slots[0]!.session, null)
    assert.equal(farm.inventory[0]!.owner, null)
  })

  it('does not release changed ownership even under the same service account', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    farm.inventory[0]!.automationLeaseId = 'newer-lease'
    await engine.release(lease.id)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(farm.inventory[0]!.automationLeaseId, 'newer-lease')
    assert.equal(farm.events.some(event => event.startsWith('release:')), false)
  })

  it('quarantines malformed create replies and prevents a second session', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    farm.malformedCreate = true
    await assert.rejects(engine.webdriver(lease.id, 'POST', '/session', {
      capabilities: {alwaysMatch: {}}
    }))
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    const before = farm.webdriverCalls.length
    await assert.rejects(engine.webdriver(lease.id, 'POST', '/session', {
      capabilities: {alwaysMatch: {}}
    }))
    assert.equal(farm.webdriverCalls.length, before)
  })

  it('quarantines ambiguous HTTP failures during creation', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate()
    farm.createStatus = 500
    try {
      await engine.webdriver(lease.id, 'POST', '/session', {capabilities: {alwaysMatch: {}}})
    }
    catch (error) {
      assert.ok(error instanceof CoordinatorError)
    }
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
  })

  it('accounts for all pending leases sharing a remote ADB host across providers', async() => {
    const farm = new FakeFarm()
    farm.inventory = [phone('ANDROID-A'), phone('ANDROID-B', {provider: 'provider-two'})]
    farm.slots.nodes = [farm.slots.nodes[0]!]
    const sharedPools = [...pools, {provider: 'provider-two', host: 'adb-one'
      , port: 5037, systemPorts: [8202]}]
    const {engine} = await fixture({}, farm, new MemoryStore(), sharedPools)
    await engine.submit(input({provider: 'provider-one'}), 'one')
    const second = await engine.submit(input({provider: 'provider-two'}), 'two')
    await engine.tick()
    assert.equal(farm.captures.length, 1, 'One free Grid slot grants at most one pending lease')
    assert.equal(engine.requestView(second.id).state, 'queued')
  })
})


describe('coordinator Maestro allocation and cleanup', () => {
  const maestroOnlyOptions = {...options}
  delete maestroOnlyOptions.appiumGridUrl

  it('rejects Appium and allocates and releases Maestro without querying Grid', async() => {
    const farm = new FakeFarm()
    const store = new MemoryStore()
    const poolConfig = pools.map(pool => ({...pool, systemPorts: []}))
    const engine = new Coordinator(maestroOnlyOptions, poolConfig, farm, store, () => initialTime)
    await engine.start()
    await rejectCode(engine.submit(input(), 'default-appium'), 'runner_disabled', 409)
    await rejectCode(engine.submit(input({runner: 'appium'}), 'explicit-appium'),
      'runner_disabled', 409)
    assert.deepEqual(store.state.requests, [])

    const request = await engine.submit(input({runner: 'maestro'}), 'maestro')
    await engine.tick()
    const leaseId = engine.requestView(request.id).leaseId
    assert.ok(leaseId)
    assert.equal(engine.leaseView(leaseId).connection.type, 'adb')
    await engine.release(leaseId)
    await engine.tick()
    assert.equal(engine.leaseView(leaseId).state, 'released')
    assert.equal(farm.gridCalls, 0)
    assert.deepEqual(farm.webdriverCalls, [])
  })

  it('refuses to start without Grid when a saved Appium lease needs cleanup', async() => {
    const {allocate, farm, store, create} = await fixture()
    const lease = await allocate()
    await create(lease.id)
    const savedLease = store.state.leases[0]!
    delete savedLease.runner // Old state files imply Appium when runner is missing.
    const before = structuredClone(store.state)
    const saves = store.saves
    const gridCalls = farm.gridCalls
    const engine = new Coordinator(maestroOnlyOptions, pools, farm, store, () => initialTime)
    await rejectCode(engine.start(), 'appium_state_requires_grid', 503)
    assert.equal(engine.ready, false)
    await engine.stop()
    assert.equal(store.saves, saves)
    assert.deepEqual(store.state, before)
    assert.equal(farm.inventory[0]?.automationLeaseId, lease.id)
    assert.equal(farm.gridCalls, gridCalls)
  })

  it('fails saved queued Appium requests and preserves history and iOS drains without Grid',
    async() => {
      const {engine: previous, allocate, farm, store} = await fixture()
      const lease = await allocate()
      await previous.release(lease.id)
      await previous.tick()
      const queued = await previous.submit(input(), 'queued-appium')
      const ios = phone('IPHONE-A', {platform: 'iOS'})
      farm.inventory.push(ios)
      await previous.startMaintenance(ios.serial, maintenanceId)
      const gridCalls = farm.gridCalls

      const engine = new Coordinator(maestroOnlyOptions, pools, farm, store, () => initialTime)
      await engine.start()
      await engine.tick()
      const request = engine.requestView(queued.id)
      assert.equal(request.state, 'failed')
      assert.equal(request.error, 'runner_disabled')
      assert.equal(store.state.requests.find(item => item.id === queued.id)?.state, 'failed')
      assert.equal(engine.leaseView(lease.id).state, 'released')
      await rejectCode(engine.finishMaintenance(maintenanceId), 'runner_disabled', 409)
      assert.equal(engine.maintenanceView(maintenanceId).serial, ios.serial)
      assert.equal(store.state.maintenance.length, 1)
      await rejectCode(engine.startMaintenance('IPHONE-B', otherMaintenanceId),
        'runner_disabled', 409)
      assert.equal(farm.gridCalls, gridCalls)
    })

  it('quarantines a saved Maestro lease after worker ownership is lost', async() => {
    const {allocate, farm, store, config} = await fixture()
    const lease = await allocate({runner: 'maestro', serial: 'ANDROID-A'})
    assert.ok(store.state.leases[0]?.maestroBaseline)
    const device = farm.inventory.find(item => item.serial === lease.device.serial)!
    // A worker restart loses its in-memory cleanup guard; the phone's native driver may survive.
    device.owner = null
    device.usage = null
    device.automationLeaseId = null
    const restarted = new Coordinator(config, pools, farm, store, () => initialTime + 1000)
    await restarted.start()
    assert.equal(restarted.leaseView(lease.id).state, 'quarantined')
    assert.equal(store.state.leases[0]?.maestroCleanupConfirmed, undefined)
    assert.ok(!farm.events.includes('maestro-cleanup:ANDROID-A'),
      'An unfenced free phone must not receive coordinator shell cleanup')
    assert.ok(!farm.events.includes('release:ANDROID-A'))
    const queued = await restarted.submit(input({runner: 'maestro', serial: 'ANDROID-A'}),
      'after-worker-loss')
    await restarted.tick()
    assert.equal(restarted.requestView(queued.id).state, 'queued')
    assert.equal(farm.captures.length, 1, 'The phone must not be reissued without cleanup proof')
    await restarted.recover(lease.id)
    assert.equal(restarted.leaseView(lease.id).state, 'quarantined')
  })

  it('persists provider cleanup proof across failed inventory verification', async() => {
    const {engine, allocate, farm, store, config} = await fixture()
    const lease = await allocate({runner: 'maestro', serial: 'ANDROID-A'})
    const release = farm.release.bind(farm)
    farm.release = async(serial, id) => {
      await release(serial, id)
      farm.inventoryError = true
    }
    await engine.release(lease.id)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(store.state.leases[0]?.maestroCleanupConfirmed, true,
      'The provider ACK must be durable even if the following inventory check fails')
    assert.equal(farm.inventory[0]?.owner, null)
    farm.inventoryError = false
    const restarted = new Coordinator(config, pools, farm, store, () => initialTime + 1000)
    await restarted.start()
    assert.equal(restarted.leaseView(lease.id).state, 'expired')
    assert.equal(farm.events.filter(event => event === 'maestro-cleanup:ANDROID-A').length, 1)
    assert.equal(farm.events.filter(event => event === 'release:ANDROID-A').length, 1)
  })

  it('recovers the exact Maestro release receipt even after a new owner takes the phone',
    async() => {
      const {engine, allocate, farm, store, config} = await fixture()
      const lease = await allocate({runner: 'maestro', serial: 'ANDROID-A'})
      const release = farm.release.bind(farm)
      const otherOwner = {email: 'new-owner@example.test'}
      farm.release = async(serial, id) => {
        await release(serial, id)
        const phone = farm.inventory[0]!
        if (!phone.owner) {
          phone.owner = otherOwner
          phone.automationLeaseId = 'new-fence'
          throw new Error('Provider confirmed cleanup but the response was lost')
        }
      }
      await engine.release(lease.id)
      await engine.tick()
      assert.equal(engine.leaseView(lease.id).state, 'quarantined')
      assert.equal(store.state.leases[0]?.maestroCleanupConfirmed, undefined)

      const restarted = new Coordinator(config, pools, farm, store, () => initialTime + 1000)
      await restarted.start()
      assert.equal(restarted.leaseView(lease.id).state, 'expired')
      assert.equal(store.state.leases[0]?.maestroCleanupConfirmed, true)
      assert.deepEqual(farm.inventory[0]?.owner, otherOwner)
      assert.equal(farm.inventory[0]?.automationLeaseId, 'new-fence')
      assert.deepEqual(farm.events.filter(event => event.startsWith('release:') ||
        event.startsWith('receipt:')), ['release:ANDROID-A', 'receipt:ANDROID-A'])
    })

  it('allocates Maestro without querying Grid or consuming an Appium port', async() => {
    const farm = new FakeFarm()
    farm.gridError = true
    const {engine, allocate, store} = await fixture({}, farm)
    farm.baselineSaved = () => assert.deepEqual(store.state.leases[0]?.maestroBaseline,
      {packages: [], settings: {'system/accelerometer_rotation': '0'}})
    const lease = await allocate({runner: 'maestro'})
    assert.equal(farm.gridCalls, 0)
    assert.deepEqual(lease.capabilities, {})
    assert.equal(lease.webdriverUrl, undefined)
    assert.equal(lease.connection.type, 'adb')
    assert.equal(lease.runner, 'maestro')
    assert.equal(engine.adbTarget(lease.id).serial, lease.device.serial)
    await rejectCode(engine.webdriver(lease.id, 'POST', '/session', {}), 'runner_conflict', 409)
  })

  it('continues Maestro scheduling when a queued Appium request cannot reach Grid', async() => {
    const farm = new FakeFarm()
    farm.gridError = true
    const {engine} = await fixture({}, farm)
    const appium = await engine.submit(input(), 'appium')
    const maestro = await engine.submit(input({runner: 'maestro'}), 'maestro')
    await engine.tick()
    assert.equal(engine.requestView(appium.id).state, 'queued')
    assert.equal(engine.requestView(maestro.id).state, 'allocated')
    assert.equal(farm.captures.length, 1)
  })

  it('grants new Maestro work while a previous Appium Grid request is still pending', async() => {
    const {engine, farm, store} = await fixture()
    const gridEntered = deferred()
    const gridFinished = deferred()
    farm.grid = async() => {
      gridEntered.resolve()
      await gridFinished.promise
      throw new Error('Grid unavailable')
    }
    const appium = await engine.submit(input({serial: 'ANDROID-B'}), 'appium')
    const appiumTick = engine.tick()
    await gridEntered.promise

    const maestro = await engine.submit(input({runner: 'maestro', queueTimeoutSeconds: 2
      , serial: 'ANDROID-A'}), 'maestro')
    const granted = deferred()
    const save = store.save.bind(store)
    store.save = async(state: CoordinatorState) => {
      await save(state)
      if (state.requests.some(request => request.id === maestro.id &&
          request.state === 'allocated')) {
        granted.resolve()
      }
    }
    const bothTicks = engine.tick()
    try {
      await Promise.race([granted.promise, delay(500).then(() => {
        assert.fail('Maestro allocation waited for Grid')
      })])
      assert.equal(engine.requestView(maestro.id).state, 'allocated')
      assert.equal(engine.requestView(appium.id).state, 'queued')
      assert.deepEqual(farm.captures.map(capture => capture.serial), ['ANDROID-A'])
    }
    finally {
      gridFinished.resolve()
      await Promise.all([appiumTick, bothTicks])
    }
    assert.equal(engine.status().lastError, 'Appium Grid is temporarily unavailable')
  })

  it('allows only Maestro on Android pools without Appium system ports', async() => {
    const poolConfig = pools.map(pool => ({...pool, systemPorts: []}))
    const {engine, farm} = await fixture({}, new FakeFarm(), new MemoryStore(), poolConfig)
    const appium = await engine.submit(input(), 'appium')
    const maestro = await engine.submit(input({runner: 'maestro'}), 'maestro')
    await engine.tick()
    assert.equal(engine.requestView(appium.id).state, 'queued')
    assert.equal(engine.requestView(maestro.id).state, 'allocated')
    assert.equal(farm.captures.length, 1)
  })

  it('closes lease streams and confirms driver cleanup before releasing STF', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate({runner: 'maestro'})
    engine.setAdbCloser(id => farm.events.push('close-adb:' + id))
    await engine.release(lease.id)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'released')
    assert.ok(farm.events.indexOf('close-adb:' + lease.id) <
      farm.events.indexOf('maestro-cleanup:ANDROID-A'))
    assert.ok(farm.events.indexOf('maestro-cleanup:ANDROID-A') <
      farm.events.indexOf('release:ANDROID-A'))
    assert.throws(() => engine.adbTarget(lease.id), /no longer active/)
  })

  it('keeps the device quarantined when Maestro cleanup cannot be confirmed', async() => {
    const {engine, allocate, farm} = await fixture()
    const lease = await allocate({runner: 'maestro'})
    farm.maestroCleanupError = true
    await engine.release(lease.id)
    await engine.tick()
    assert.equal(engine.leaseView(lease.id).state, 'quarantined')
    assert.equal(farm.inventory[0]?.automationLeaseId, lease.id)
    assert.ok(!farm.events.includes('release:ANDROID-A'))
  })

  it('recovers a persisted Maestro baseline and cleans before reissuing the device', async() => {
    const {engine, allocate, farm, store} = await fixture()
    const lease = await allocate({runner: 'maestro'})
    const restarted = new Coordinator(maestroOnlyOptions, pools, farm, store,
      () => initialTime + 1000)
    await restarted.start()
    assert.equal(restarted.leaseView(lease.id).state, 'expired')
    assert.ok(farm.events.includes('maestro-cleanup:ANDROID-A'))
    assert.equal(farm.inventory[0]?.owner, null)
    assert.equal(farm.gridCalls, 0)
    await engine.stop()
  })

  it('rejects physical iOS Maestro before putting a request in the queue', async() => {
    const {engine} = await fixture()
    await rejectCode(engine.submit(input({runner: 'maestro', platform: 'iOS'}), 'invalid'),
      'unsupported_runner', 400)
  })
})


function iosFarm() {
  const farm = new FakeFarm()
  farm.inventory = [phone('IPHONE-A', {platform: 'iOS', version: '27.0.1'
    , ios: {wda: freshWda()}})]
  farm.slots.nodes = [{id: 'ios-node', availability: 'UP', slots: [{session: null
    , stereotype: {platformName: 'iOS', 'appium:udid': 'IPHONE-A'
      , 'appium:platformVersion': '27.0.1'}}]}]
  return farm
}

describe('coordinator WDA signing eligibility', () => {
  it('rejects noncanonical inventory platforms instead of bypassing iOS signing checks',
    async() => {
    const farm = iosFarm()
    farm.inventory[0]!.platform = 'ios' as FarmDevice['platform']
    delete farm.inventory[0]!.ios
    const {engine} = await fixture({}, farm)
    const request = await engine.submit(input({platform: 'iOS'}), 'noncanonical-platform')
    await engine.tick()
    assert.equal(engine.requestView(request.id).state, 'queued')
    assert.equal(farm.captures.length, 0)
  })

  it('requires fresh unambiguous signing that covers the requested duration and safety margin',
    async() => {
    const cases: {name: string, wda: unknown, allowed: boolean}[] = [
      {name: 'valid', wda: freshWda(), allowed: true}
    , {name: 'expiring but sufficient', wda: {...freshWda(), profile: 'expiring'}, allowed: true}
    , {name: 'exact expiry boundary', wda: freshWda(initialTime + 360000), allowed: false}
    , {name: 'one millisecond above boundary', wda: freshWda(initialTime + 360001), allowed: true}
    , {name: 'short of boundary', wda: freshWda(initialTime + 359999), allowed: false}
    , {name: 'exact freshness boundary'
        , wda: freshWda(undefined, initialTime - 3600000)
        , allowed: true}
    , {name: 'stale by one millisecond'
        , wda: freshWda(undefined, initialTime - 3600001)
        , allowed: false}
    , {name: 'future clock tolerance', wda: freshWda(undefined, initialTime + 60000), allowed: true}
    , {name: 'future beyond tolerance'
        , wda: freshWda(undefined, initialTime + 60001)
        , allowed: false}
    , {name: 'ambiguous', wda: {...freshWda(), profile: 'ambiguous'}, allowed: false}
    , {name: 'unknown', wda: {...freshWda(), profile: 'unknown'}, allowed: false}
    , {name: 'expired despite future date'
        , wda: {...freshWda(), profile: 'expired'}
        , allowed: false}
    , {name: 'missing', wda: null, allowed: false}
    , {name: 'noncanonical date', wda: {...freshWda(), expiresAt: '2026-10-19'}, allowed: false}
    , {name: 'invalid normalized date'
        , wda: {...freshWda(), expiresAt: '2027-02-31T00:00:00.000Z'}
        , allowed: false}
    , {name: 'missing checkedAt', wda: {...freshWda(), checkedAt: null}, allowed: false}
    ]
    for (const sample of cases) {
      const farm = iosFarm()
      farm.inventory[0]!.ios = {wda: sample.wda as ReturnType<typeof freshWda>}
      const {engine} = await fixture({}, farm)
      const request = await engine.submit(input({platform: 'iOS'}), sample.name)
      await engine.tick()
      assert.equal(engine.requestView(request.id).state,
        sample.allowed ? 'allocated' : 'queued', sample.name)
      assert.equal(farm.captures.length, sample.allowed ? 1 : 0, sample.name)
    }
  })

  it('uses each request duration rather than only the configured maximum', async() => {
    const farm = iosFarm()
    farm.inventory[0]!.ios = {wda: freshWda(initialTime + 400000)}
    const {engine} = await fixture({maxDurationSeconds: 120}, farm)
    const long = await engine.submit(input({platform: 'iOS', maxDurationSeconds: 120}), 'long')
    const short = await engine.submit(input({platform: 'iOS', maxDurationSeconds: 60}), 'short')
    await engine.tick()
    assert.equal(engine.requestView(long.id).state, 'queued')
    assert.equal(engine.requestView(short.id).state, 'allocated')
  })

  it('preserves Android allocation without iOS telemetry', async() => {
    const {allocate} = await fixture()
    assert.equal((await allocate()).device.platform, 'Android')
  })
})

describe('coordinator persistent iOS maintenance drain', () => {
  it('preserves a drain and its held lease across restart until verified completion',
    async() => {
    const f = await fixture({}, iosFarm())
    const lease = await f.allocate({platform: 'iOS'})
    const events = [...f.farm.events]
    assert.equal((await f.engine.startMaintenance('IPHONE-A', maintenanceId)).state, 'draining')
    assert.deepEqual(f.farm.events, events, 'Starting maintenance cannot mutate STF or WDA')
    assert.equal(f.engine.leaseView(lease.id).state, 'active')
    await rejectCode(f.engine.finishMaintenance(maintenanceId), 'device_busy', 409)
    const queued = await f.engine.submit(input({platform: 'iOS'}), 'after-renewal')
    await f.engine.release(lease.id)
    await f.engine.tick()
    assert.equal(f.engine.leaseView(lease.id).state, 'released')
    assert.equal(f.engine.requestView(queued.id).state, 'queued')
    assert.equal(f.engine.maintenanceView(maintenanceId).state, 'ready')
    const restarted = new Coordinator(f.config, pools, f.farm, f.store, f.now)
    await restarted.start()
    assert.equal(restarted.maintenanceView(maintenanceId).serial, 'IPHONE-A')
    assert.equal((await restarted.finishMaintenance(maintenanceId)).state, 'completed')
    assert.deepEqual(f.store.state.maintenance, [])
    await restarted.tick()
    assert.equal(restarted.requestView(queued.id).state, 'allocated')
  })

  it('rejects competing drains and unknown devices while allowing identical retries', async() => {
    const {engine, farm, store} = await fixture({}, iosFarm())
    const first = await engine.startMaintenance('IPHONE-A', maintenanceId)
    assert.deepEqual(await engine.startMaintenance('IPHONE-A', maintenanceId), first)
    assert.equal(store.state.maintenance.length, 1)
    await rejectCode(engine.startMaintenance('IPHONE-A', otherMaintenanceId),
      'maintenance_conflict', 409)
    farm.inventory.push(phone('IPHONE-B', {platform: 'iOS'}))
    await rejectCode(engine.startMaintenance('IPHONE-B', maintenanceId),
      'maintenance_conflict', 409)
    await rejectCode(engine.startMaintenance('MISSING-A', otherMaintenanceId),
      'device_not_found', 404)
    farm.inventory.push(phone('ANDROID-A'))
    await rejectCode(engine.startMaintenance('ANDROID-A', otherMaintenanceId),
      'unsupported_maintenance', 400)
    await rejectCode(engine.startMaintenance('IPHONE-A', 'arbitrary-text'),
      'invalid_maintenance', 400)
  })

  it('excludes a device when scheduling fetched an earlier inventory snapshot', async() => {
    const {engine, farm} = await fixture({}, iosFarm())
    const request = await engine.submit(input({platform: 'iOS'}), 'concurrent-allocation')
    const barrier = deferred()
    farm.inventoryBarrier = barrier
    farm.inventoryEntered = deferred()
    const tick = engine.tick()
    await farm.inventoryEntered.promise
    farm.inventoryBarrier = null
    await engine.startMaintenance('IPHONE-A', maintenanceId)
    barrier.resolve()
    await tick
    assert.equal(engine.requestView(request.id).state, 'queued')
    assert.equal(farm.captures.length, 0)
  })

  it('keeps maintenance on busy devices, insufficient signing and uncertain Grid cleanup',
    async() => {
    const {engine, farm, store} = await fixture({}, iosFarm())
    await engine.startMaintenance('IPHONE-A', maintenanceId)
    const pristine = structuredClone(farm.inventory[0]!)
    const samples: Partial<FarmDevice>[] = [
      {present: false}, {ready: false}, {owner: {email: 'manual@example.test'}}
    , {using: true}, {claimed: true}, {usage: 'automation'}, {automationLeaseId: 'stale'}
    , {ios: {wda: freshWda(initialTime + 360000)}}
    , {ios: {wda: {...freshWda(), profile: 'ambiguous'}}}
    , {ios: {wda: freshWda(undefined, initialTime - 3600001)}}
    ]
    for (const sample of samples) {
      farm.inventory[0] = {...structuredClone(pristine), ...sample}
      await rejectCode(engine.finishMaintenance(maintenanceId), 'device_not_ready', 409)
      assert.equal(store.state.maintenance.length, 1)
    }
    farm.inventory[0] = pristine
    const slot = farm.slots.nodes[0]!.slots[0]!
    slot.session = {sessionId: 'external-session', capabilities: {'appium:udid': 'IPHONE-A'}}
    await rejectCode(engine.finishMaintenance(maintenanceId), 'device_busy', 409)
    slot.session = {sessionId: 'unknown-session', capabilities: {}}
    await rejectCode(engine.finishMaintenance(maintenanceId), 'device_busy', 409)
    slot.session = null
    farm.gridError = true
    await assert.rejects(engine.finishMaintenance(maintenanceId))
    assert.equal(store.state.maintenance.length, 1)
    farm.gridError = false
    farm.slots.nodes[0]!.availability = 'DOWN'
    await rejectCode(engine.finishMaintenance(maintenanceId), 'device_busy', 409)
    farm.slots.nodes[0]!.availability = 'UP'
    assert.equal((await engine.finishMaintenance(maintenanceId)).state, 'completed')
  })

  it('requires the maximum supported duration before reopening a device', async() => {
    const {engine, farm} = await fixture({maxDurationSeconds: 120}, iosFarm())
    await engine.startMaintenance('IPHONE-A', maintenanceId)
    farm.inventory[0]!.ios = {wda: freshWda(initialTime + 400000)}
    await rejectCode(engine.finishMaintenance(maintenanceId), 'device_not_ready', 409)
    farm.inventory[0]!.ios = {wda: freshWda(initialTime + 420001)}
    await engine.finishMaintenance(maintenanceId)
  })
})


describe('operator reconciliation of uncertain captures', () => {
  const acknowledgment = (serial = 'ANDROID-A'): CaptureReconciliationInput => ({
    serial, captureTransportRetired: true, reason: 'Old capture transport retired in maintenance'
  , actor: 'operator', projectId: 'legacy'
  })
  async function uncertain(serial = 'ANDROID-A') {
    const farm = new FakeFarm(); const store = new MemoryStore()
    farm.inventory[0] = phone(serial)
    const createdAt = initialTime - 600000
    store.state = {version: 2, maintenance: [], requests: [{
      id: 'uncertain-request', key: 'old-key', fingerprint: 'old-fingerprint', state: 'allocated'
    , input: input({serial}), createdAt, queueDeadlineAt: createdAt + 60000
    , leaseId: 'uncertain-lease'
    }], leases: [{
      id: 'uncertain-lease', requestId: 'uncertain-request', runId: 'old-run'
    , state: 'quarantined', runner: 'appium', device: phone(serial)
    , capabilities: {'appium:udid': serial}, createdAt, expiresAt: createdAt + 10000
    , deadlineAt: createdAt + 60000, captureUncertain: true
    , finishState: 'released', error: 'cleanup_unconfirmed'
    }]}
    const f = await fixture({}, farm, store)
    return {...f, id: 'uncertain-lease', acknowledgment: acknowledgment(serial)}
  }
  const current = (engine: Coordinator) =>
    (engine as unknown as {state: CoordinatorState}).state.leases[0]!

  it('keeps default recovery quarantined until explicit, audited reconciliation',
    async() => {
    const f = await uncertain()
    await f.engine.recover(f.id)
    assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
    const requests = structuredClone(f.store.state.requests)
    const result = await f.engine.recover(f.id, f.acknowledgment)
    assert.equal(result.state, 'expired')
    assert.equal(result.captureReconciliation?.previousError, 'cleanup_unconfirmed')
    assert.equal(result.captureReconciliation?.captureTransportRetired, true)
    assert.equal(result.captureReconciliation?.reason, f.acknowledgment.reason)
    assert.equal(result.captureReconciliation?.actor, 'operator')
    assert.equal(result.captureReconciliation?.projectId, 'legacy')
    assert.equal(f.store.state.leases.length, 1)
    assert.equal(f.store.state.leases[0]!.captureUncertain, undefined)
    assert.equal(f.store.state.leases[0]!.error, undefined)
    assert.deepEqual(f.store.state.requests, requests)
    assert.equal(f.farm.captures.length, 0)
    assert.equal(f.farm.webdriverCalls.length, 0)
    assert.equal(f.farm.events.some(event => event.startsWith('release:')), false)
  })

  it('keeps the original audit on exact retries, including after restart',
    async() => {
    const f = await uncertain('2a3e120')
    const first = await f.engine.recover(f.id, f.acknowledgment)
    const durable = structuredClone(f.store.state)
    const saves = f.store.saves
    assert.deepEqual(await f.engine.recover(f.id, f.acknowledgment), first)
    assert.equal(f.store.saves, saves)
    const restarted = new Coordinator(f.config, pools, f.farm, f.store, f.now)
    await restarted.start()
    const restartedSaves = f.store.saves
    assert.deepEqual(await restarted.recover(f.id, f.acknowledgment), first)
    assert.equal(f.store.saves, restartedSaves)
    assert.deepEqual(f.store.state, durable)
    await rejectCode(restarted.recover(f.id), 'not_quarantined', 409)
    await rejectCode(restarted.recover(f.id, {...f.acknowledgment, reason: 'Different operation'}),
      'reconciliation_unavailable', 409)
    await rejectCode(restarted.recover(f.id, {...f.acknowledgment, serial: 'ANOTHER'}),
      'reconciliation_unavailable', 409)
  })

  it('does not treat an ordinary completed lease as an idempotent reconciliation', async() => {
    const f = await fixture()
    const lease = await f.allocate()
    await f.engine.release(lease.id)
    await f.engine.tick()
    await rejectCode(f.engine.recover(lease.id, acknowledgment(lease.device.serial)),
      'not_quarantined', 409)
  })

  it('requires an explicit retirement acknowledgment, reason and authenticated operator identity',
    async() => {
    const f = await uncertain()
    for (const override of [
      {captureTransportRetired: undefined}, {captureTransportRetired: false}
    , {captureTransportRetired: 'true'}, {reason: ''}, {reason: '  '}
    , {reason: 'x'.repeat(1025)}, {actor: undefined}, {actor: 'project'}
    , {projectId: ''}, {serial: ''}, {serial: 'not a serial'}
    ]) {
      await rejectCode(f.engine.recover(f.id,
        {...f.acknowledgment, ...override} as CaptureReconciliationInput),
      'invalid_reconciliation', 400)
    }
    assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
    assert.equal(f.store.state.leases[0]!.captureReconciliation, undefined)
  })

  it('rejects wrong devices, fresh captures and unresolved local session operations', async() => {
    const f = await uncertain()
    await rejectCode(f.engine.recover(f.id, {...f.acknowledgment, serial: 'ANDROID-B'}),
      'reconciliation_unavailable', 409)
    for (const [key, value] of Object.entries({sessionId: 'old-session', creatingSession: true
      , commandInFlight: true, captureConfirmed: true, runner: 'maestro'
      , captureUncertain: false})) {
      const lease = current(f.engine)
      const before = structuredClone(lease)
      Object.assign(lease, {[key]: value})
      await rejectCode(f.engine.recover(f.id, f.acknowledgment),
        'reconciliation_unavailable', 409)
      Object.assign(lease, before)
      if (!(key in before)) {
 delete (lease as unknown as Record<string, unknown>)[key]
}
    }
    const lease = current(f.engine)
    lease.createdAt = f.now()
    await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'capture_not_settled', 409)
    lease.createdAt = initialTime - 600000
    for (const name of ['allocations', 'commands', 'cleanups'] as const) {
      const map = (f.engine as unknown as Record<typeof name, Map<string, Promise<void>>>)[name]
      map.set(f.id, Promise.resolve())
      await rejectCode(f.engine.recover(f.id, f.acknowledgment),
        'reconciliation_unavailable', 409)
      map.delete(f.id)
    }
  })

  it('refuses missing, duplicate, unavailable or owned STF devices', async() => {
    for (const change of [
      (farm: FakeFarm) => {
 farm.inventory = farm.inventory.slice(1)
}
    , (farm: FakeFarm) => {
 farm.inventory.push(structuredClone(farm.inventory[0]!))
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.present = false
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.ready = false
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.provider = 'different-provider'
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.owner = {email: 'another@example.test'}
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.using = true
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.claimed = true
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.usage = 'automation'
}
    , (farm: FakeFarm) => {
 farm.inventory[0]!.automationLeaseId = 'other-lease'
}
    ]) {
      const f = await uncertain()
      change(f.farm)
      await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'device_busy', 409)
      assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
    }
  })

  it('fails closed on malformed Grid snapshots, duplicate identities and uncertain sessions',
    async() => {
    for (const change of [
      (grid: GridStatus) => {
 grid.ready = false
}
    , (grid: GridStatus) => {
      grid.nodes[0]!.id = '  '
    }
    , (grid: GridStatus) => {
 grid.nodes = []
}
    , (grid: GridStatus) => {
 grid.nodes[1]!.id = grid.nodes[0]!.id
}
    , (grid: GridStatus) => {
 (grid.nodes[0] as any).slots = undefined
}
    , (grid: GridStatus) => {
 (grid.nodes[0]!.slots[0] as any).stereotype = null
}
    , (grid: GridStatus) => {
 (grid.nodes[0]!.slots[0] as any).session = {}
}
    , (grid: GridStatus) => {
 grid.nodes[0]!.slots[0]!.session = {
        sessionId: 'unknown', capabilities: {}}
      }
    , (grid: GridStatus) => {
      grid.nodes[0]!.slots[0]!.session = {
        sessionId: 'unknown', capabilities: {'appium:udid': '  '}}
    }
    , (grid: GridStatus) => {
 grid.nodes.forEach(node => {
 node.slots[0]!.session = {
        sessionId: 'duplicate', capabilities: {'appium:udid': 'OTHER'}}
})
}
    , (grid: GridStatus) => {
 grid.nodes.forEach(node => {
 node.availability = 'DOWN'
})
}
    ]) {
      const f = await uncertain()
      change(f.farm.slots)
      await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'grid_unavailable', 409)
      assert.equal(f.store.state.leases[0]!.captureReconciliation, undefined)
    }
    for (const capabilities of [{'appium:udid': 'ANDROID-A'}
      , {'appium:udid': 'OTHER', 'stf:leaseId': 'uncertain-lease'}]) {
      const f = await uncertain()
      f.farm.slots.nodes[0]!.slots[0]!.session = {sessionId: 'busy', capabilities}
      await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'device_busy', 409)
    }
  })

  it('keeps quarantine when either upstream observation fails', async() => {
    for (const failure of ['inventoryError', 'gridError'] as const) {
      const f = await uncertain()
      f.farm[failure] = true
      await assert.rejects(f.engine.recover(f.id, f.acknowledgment))
      assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
      assert.equal(f.store.state.leases[0]!.captureReconciliation, undefined)
    }
  })

  it('checks fresh upstream state again and rejects ownership changes during observation',
    async() => {
    const f = await uncertain()
    const devices = f.farm.devices.bind(f.farm)
    let observations = 0
    f.farm.devices = async() => {
      const snapshot = await devices()
      if (++observations === 1) {
 f.farm.inventory[0]!.owner = {email: 'another@example.test'}
}
      return snapshot
    }
    await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'device_busy', 409)
    assert.equal(observations, 2)
    assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
  })

  it('coalesces identical in-flight acknowledgments and rejects conflicting recovery requests',
    async() => {
    const f = await uncertain()
    f.farm.inventoryBarrier = deferred()
    f.farm.inventoryEntered = deferred()
    const first = f.engine.recover(f.id, f.acknowledgment)
    await f.farm.inventoryEntered.promise
    const duplicate = f.engine.recover(f.id, f.acknowledgment)
    await rejectCode(f.engine.recover(f.id, {...f.acknowledgment, reason: 'Different reason'}),
      'recovery_in_progress', 409)
    await rejectCode(f.engine.recover(f.id), 'recovery_in_progress', 409)
    f.farm.inventoryBarrier.resolve()
    assert.deepEqual(await duplicate, await first)
    assert.equal(f.farm.gridCalls, 2)
  })

  it('does not publish a free lease before the reconciliation is durably saved', async() => {
    const f = await uncertain()
    f.store.saveBarrier = deferred()
    f.store.saveEntered = deferred()
    const pending = f.engine.recover(f.id, f.acknowledgment)
    await f.store.saveEntered.promise
    assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
    assert.equal(f.store.state.leases[0]!.state, 'quarantined')
    f.store.saveBarrier.resolve()
    assert.equal((await pending).state, 'expired')
    assert.equal(f.store.state.leases[0]!.state, 'expired')
  })

  it('retains quarantine in memory and storage after a failed reconciliation save', async() => {
    const f = await uncertain()
    const before = structuredClone(f.store.state)
    f.store.failWrites = true
    await rejectCode(f.engine.recover(f.id, f.acknowledgment), 'state_unavailable', 503)
    assert.equal(f.engine.leaseView(f.id).state, 'quarantined')
    assert.equal(f.engine.leaseView(f.id).captureReconciliation, undefined)
    assert.deepEqual(f.store.state, before)
    assert.equal(f.engine.ready, false)
  })

  it('preserves another allocation already waiting on its upstream capture', async() => {
    const f = await uncertain()
    f.farm.captureBarrier = deferred()
    f.farm.captureEntered = deferred()
    const request = await f.engine.submit(input({serial: 'ANDROID-B'}), 'other-allocation')
    const tick = f.engine.tick()
    await f.farm.captureEntered.promise
    await f.engine.recover(f.id, f.acknowledgment)
    f.farm.captureBarrier.resolve()
    await tick
    const allocated = f.engine.requestView(request.id)
    assert.equal(allocated.state, 'allocated')
    assert.equal(f.engine.leaseView(allocated.leaseId!).state, 'active')
    assert.equal(f.store.state.leases.find(lease => lease.id === allocated.leaseId)!.state,
      'active')
  })

  it('does not reconcile after cancellation or shutdown wins during upstream reads', async() => {
    for (const stop of [false, true]) {
      const f = await uncertain()
      f.farm.inventoryBarrier = deferred()
      f.farm.inventoryEntered = deferred()
      const recovering = f.engine.recover(f.id, f.acknowledgment)
      await f.farm.inventoryEntered.promise
      const observed = assert.rejects(recovering)
      const stopping = stop ? f.engine.stop() : null
      if (!stop) {
        await f.engine.release(f.id)
      }
      f.farm.inventoryBarrier.resolve()
      await observed
      await stopping
      assert.equal(f.engine.leaseView(f.id).captureReconciliation, undefined)
    }
  })
})
