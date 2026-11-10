import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {FileStateStore} from '../../lib/units/coordinator/state.js'
import type {CoordinatorState} from '../../lib/units/coordinator/types.js'

describe('coordinator durable Maestro cleanup proof', () => {
  it('rejects non-boolean cleanup proof during recovery', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'stf-cleanup-proof-'))
    const store = new FileStateStore(join(directory, 'state.json'))
    const state: CoordinatorState = {version: 2, maintenance: [], requests: [{
      id: 'request', key: 'key', fingerprint: 'fingerprint', state: 'allocated',
      input: {runner: 'maestro', platform: 'Android', runId: 'run',
        queueTimeoutSeconds: 60, maxDurationSeconds: 60},
      createdAt: 0, queueDeadlineAt: 60000, leaseId: 'lease'
    }], leases: [{
      id: 'lease', requestId: 'request', runId: 'run', runner: 'maestro', state: 'cleaning',
      capabilities: {}, createdAt: 0, expiresAt: 10000, deadlineAt: 60000,
      device: {serial: 'ANDROID-A', platform: 'Android', model: 'Phone', version: '16',
        provider: 'provider', present: true, ready: true},
      maestroBaseline: {packages: [], settings: {'system/accelerometer_rotation': '0'}},
      maestroCleanupConfirmed: true
    }]}
    try {
      for (const proof of [true, false]) {
        state.leases[0]!.maestroCleanupConfirmed = proof
        await store.save(state)
        assert.equal((await store.load()).leases[0]!.maestroCleanupConfirmed, proof)
      }
      for (const proof of ['true', 1, {}, []]) {
        const malformed = structuredClone(state) as unknown as {
          leases: {maestroCleanupConfirmed: unknown}[]
        }
        malformed.leases[0]!.maestroCleanupConfirmed = proof
        await store.save(malformed as unknown as CoordinatorState)
        await assert.rejects(store.load(), /Invalid coordinator state/,
          'A truthy value cannot serve as evidence of provider cleanup')
      }
    }
    finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
