import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {FileStateStore} from '../../lib/units/coordinator/state.js'
import type {CoordinatorState} from '../../lib/units/coordinator/types.js'

const empty = (): CoordinatorState => ({version: 2, maintenance: [], requests: [], leases: []})

describe('coordinator persistent state', () => {
  let directory: string, filename: string

  beforeEach(async() => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-state-test-'))
    filename = path.join(directory, 'private', 'coordinator.json')
  })

  afterEach(async() => {
    await rm(directory, {recursive: true, force: true})
  })

  it('starts with an empty state only when the file does not exist', async() => {
    assert.deepEqual(await new FileStateStore(filename).load(), empty())
  })

  it('persists exact state with private permissions and no leftover temporary files', async() => {
    const store = new FileStateStore(filename)
    await store.save(empty())
    assert.deepEqual(await new FileStateStore(filename).load(), empty())
    assert.equal((await stat(filename)).mode & 0o777, 0o600)
    assert.equal((await stat(path.dirname(filename))).mode & 0o777, 0o700)
    assert.deepEqual(await readdir(path.dirname(filename)), ['coordinator.json'])
  })

  it('migrates version 1 without changing requests or leases and persists version 2', async() => {
    const store = new FileStateStore(filename)
    await store.save(empty())
    const legacy = {version: 1, requests: [{
      id: 'legacy-request', key: 'legacy-key', fingerprint: 'fingerprint', state: 'allocated'
      , input: {platform: 'Android', runId: 'legacy-run', queueTimeoutSeconds: 60
        , maxDurationSeconds: 60}, createdAt: 0, queueDeadlineAt: 60000, leaseId: 'legacy-lease'
    }], leases: [{id: 'legacy-lease', requestId: 'legacy-request', runId: 'legacy-run'
      , state: 'released', createdAt: 0, expiresAt: 10000, deadlineAt: 60000
      , device: {serial: 'ANDROID-A', platform: 'Android', model: 'Phone', version: '16'
        , provider: 'provider', present: true, ready: true}
      , capabilities: {'appium:udid': 'ANDROID-A'}}]}
    await writeFile(filename, JSON.stringify(legacy), {mode: 0o600})
    const migrated = await store.load()
    assert.deepEqual(migrated, {...legacy, version: 2, maintenance: []})
    await store.save(migrated)
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).version, 2)
  })

  it('persists drains and refuses malformed or duplicate maintenance instead of losing isolation',
    async() => {
    const store = new FileStateStore(filename)
    const maintenance = {id: '34725f38-4b42-4c84-94d8-31eb3baa2478'
      , serial: 'IPHONE-A', createdAt: 42}
    await store.save({...empty(), maintenance: [maintenance]})
    assert.deepEqual((await store.load()).maintenance, [maintenance])
    const invalid = [
      {...empty(), maintenance: undefined}, {...empty(), maintenance: null}
    , {...empty(), maintenance: [{...maintenance, id: 'not-a-uuid'}]}
    , {...empty(), maintenance: [{...maintenance, createdAt: '42'}]}
    , {...empty(), maintenance: [maintenance, maintenance]}
    , {...empty(), maintenance: [maintenance, {...maintenance
        , id: '71b30b15-1f08-4dfb-9126-761897aa9cc0'}]}
    , {...empty(), version: 1, maintenance: [maintenance]}
    ]
    for (const value of invalid) {
      await writeFile(filename, JSON.stringify(value), {mode: 0o600})
      await assert.rejects(store.load(), /Invalid coordinator state/)
    }
  })

  it('retains the operator reconciliation audit and rejects malformed proof', async() => {
    const store = new FileStateStore(filename)
    const audit = {at: 900000, mode: 'unowned-capture' as const
      , captureTransportRetired: true as const, reason: 'Capture transport retired in maintenance'
      , actor: 'operator' as const, projectId: 'legacy', previousError: 'cleanup_unconfirmed'}
    const reconciled: CoordinatorState = {version: 2, maintenance: [], requests: [{
      id: 'request', key: 'key', fingerprint: 'fingerprint', state: 'allocated'
    , input: {runId: 'run', platform: 'Android', queueTimeoutSeconds: 60, maxDurationSeconds: 60}
    , createdAt: 0, queueDeadlineAt: 60000, leaseId: 'lease'
    }], leases: [{
      id: 'lease', requestId: 'request', runId: 'run', state: 'released', runner: 'appium'
    , createdAt: 0, expiresAt: 10000, deadlineAt: 60000
    , device: {serial: '2a3e120', platform: 'Android', model: 'Phone', version: '16'
        , provider: 'provider', present: true, ready: true}
    , capabilities: {'appium:udid': '2a3e120'}, captureReconciliation: audit
    }]}
    await store.save(reconciled)
    assert.deepEqual(await new FileStateStore(filename).load(), reconciled)
    for (const invalidAudit of [
      null, {}, {...audit, at: '900000'}, {...audit, at: -1}, {...audit, mode: 'automatic'}
    , {...audit, previousError: ''}, {...audit, previousError: null}
    , {...audit, captureTransportRetired: undefined}, {...audit, captureTransportRetired: false}
    , {...audit, reason: ''}, {...audit, reason: '  '}, {...audit, reason: 'x'.repeat(1025)}
    , {...audit, actor: 'project'}, {...audit, projectId: ''}, {...audit, projectId: undefined}
    ]) {
      const invalid = structuredClone(reconciled)
      Object.assign(invalid.leases[0]!, {captureReconciliation: invalidAudit})
      await writeFile(filename, JSON.stringify(invalid), {mode: 0o600})
      await assert.rejects(store.load(), /Invalid coordinator state/)
    }
    for (const invalidLease of [{state: 'quarantined'}, {captureUncertain: true}
      , {sessionId: 'session'}, {creatingSession: true}, {commandInFlight: true}]) {
      const invalid = structuredClone(reconciled)
      Object.assign(invalid.leases[0]!, invalidLease)
      await writeFile(filename, JSON.stringify(invalid), {mode: 0o600})
      await assert.rejects(store.load(), /Invalid coordinator state/)
    }
  })

  it('retains the previous durable file if replacement serialization fails', async() => {
    const store = new FileStateStore(filename)
    await store.save(empty())
    const previous = await readFile(filename, 'utf8')
    const circular = empty() as CoordinatorState & {circular?: unknown}
    circular.circular = circular
    await assert.rejects(store.save(circular), /circular/i)
    assert.equal(await readFile(filename, 'utf8'), previous)
    assert.deepEqual(await readdir(path.dirname(filename)), ['coordinator.json'])
  })

  it('refuses malformed JSON instead of silently discarding recovery state', async() => {
    await new FileStateStore(filename).save(empty())
    await writeFile(filename, '{"version":1,"leases":[', {mode: 0o600})
    await assert.rejects(new FileStateStore(filename).load())
  })

  it('rejects unsupported versions and incomplete request or lease records', async() => {
    const invalid = [
      {...empty(), version: 3}
    , {...empty(), requests: [{id: 'request-one', input: {}, state: 'queued'}]}
    , {...empty(), leases: [{id: 'lease-one', device: {serial: 'ANDROID-A'}, state: 'active'}]}
    , {...empty(), requests: [{id: 'request-one', input: {runId: 'run'}, state: 'unknown'}]}
    ]
    await new FileStateStore(filename).save(empty())
    for (const value of invalid) {
      await writeFile(filename, JSON.stringify(value), {mode: 0o600})
      await assert.rejects(new FileStateStore(filename).load(),
        'Incomplete persistent state cannot justify safe device reissue')
    }
  })
})


describe('coordinator Maestro recovery state', () => {
  it('persists a Maestro lease without Appium capabilities and retains its cleanup baseline',
    async() => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'coordinator-maestro-state-'))
    const filename = path.join(directory, 'state.json')
    try {
      const state: CoordinatorState = {version: 2, maintenance: [], requests: [{
        id: 'request', key: 'key', fingerprint: 'fingerprint', state: 'allocated'
      , input: {runner: 'maestro', platform: 'Android', runId: 'run'
          , queueTimeoutSeconds: 60, maxDurationSeconds: 60}
      , createdAt: 0, queueDeadlineAt: 60000, leaseId: 'lease'
      }], leases: [{
        id: 'lease', requestId: 'request', runId: 'run', runner: 'maestro', state: 'active'
      , capabilities: {}, createdAt: 0, expiresAt: 10000, deadlineAt: 60000
      , device: {serial: 'ANDROID-A', platform: 'Android', model: 'Phone', version: '16'
          , provider: 'provider', present: true, ready: true}
      , maestroBaseline: {packages: [], settings: {'system/accelerometer_rotation': '0'}}
      }]}
      const store = new FileStateStore(filename)
      await store.save(state)
      assert.deepEqual(await store.load(), state)
      state.leases[0]!.runner = 'appium'
      await store.save(state)
      await assert.rejects(store.load(), /Invalid coordinator state/)
    }
    finally {
 await rm(directory, {recursive: true, force: true})
}
  })
})
