import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import r from 'rethinkdb'
import type DbApi from '../../lib/db/api.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

// Run in a separate process: the unit suite replaces db.run with a query recorder.
// Never use STF's database environment; create and drop only this test's database.
const port = Number(process.env.STF_DB_TEST_PORT || 28015)
assert(Number.isInteger(port) && port > 1024 && port <= 65535)
const database = 'stf_ownership_' + randomUUID().replaceAll('-', '')
const root = await r.connect({host: '127.0.0.1', port, timeout: 3})
const connections: r.Connection[] = []
let created = false
try {
  await r.dbCreate(database).run(root)
  created = true
  const apis: Array<typeof DbApi> = []
  for (let index = 0; index < 2; index++) {
    const conn = await r.connect({host: '127.0.0.1', port, db: database, timeout: 3})
    connections.push(conn)
    const restore = mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
      run: (query: r.Operation<unknown>, options?: Partial<r.OperationOptions>) =>
        query.run(conn, options)
    }})
    try {
      apis.push((await importFresh(new URL('../../lib/db/api.js', import.meta.url))).default)
    }
    finally {
      restore()
    }
  }
  await r.tableCreate('devices', {primaryKey: 'serial'}).run(connections[0]!)
  const [a, b] = apis as [typeof DbApi, typeof DbApi]
  const owner = (reservationId?: string) => ({email: 'runner@example.test'
    , name: 'Runner', group: 'runner-channel', ...(reservationId ? {reservationId} : {})})
  const A = owner('reservation-a')
  const B = owner('reservation-b')
  const read = (serial: string) => r.table('devices').get<any>(serial).run(connections[0]!)
  const seed = (serial: string, extra = {}) => r.table('devices').insert({serial
    , owner: null, usage: null, automationLeaseId: null, ...extra}).run(connections[0]!)
  function applied(stats: Awaited<ReturnType<typeof DbApi.releaseDeviceOwner>>, expected: boolean) {
    assert.equal(stats.errors, 0, stats.first_error)
    assert.equal(stats.applied, expected)
  }
  async function retainsB(serial: string) {
    const row = await read(serial)
    assert.equal(row.owner?.reservationId, B.reservationId)
    assert.equal(row.automationLeaseId, 'lease-b')
    assert.equal(row.usage, 'automation')
  }

  // Leave may reach one processor before another commits the corresponding Join.
  // Older providers omit the leaseId on Leave; the matching late Join supplies it.
  for (const leaseId of ['lease-a', null]) {
    const serial = leaseId ? 'early-exact' : 'early-old-provider'
    await seed(serial, {automationRelease: {email: B.email, leaseId: 'prior-b'}})
    const released = await a.releaseDeviceOwner(serial, A, leaseId)
    applied(released, false)
    assert.equal(released.replaced, 1, 'recording a tombstone is not an ownership release')
    assert.equal(await b.hasDeviceAutomationRelease(serial, A.email, 'lease-a'), Boolean(leaseId))
    applied(await b.setDeviceOwner(serial, B, 'automation', 'lease-b'), true)
    applied(await a.setDeviceOwner(serial, A, 'automation', 'lease-a'), false)
    await retainsB(serial)
    assert.equal(await b.hasDeviceAutomationRelease(serial, A.email, 'lease-a'), true)
    assert.equal(await b.hasDeviceAutomationRelease(serial, 'other@example.test', 'lease-a'), false)
    assert.equal(await b.hasDeviceAutomationRelease(serial, A.email, 'wrong-lease'), false)
    assert.equal(await b.hasDeviceAutomationRelease(serial, B.email, 'prior-b'), true)
    applied(await b.releaseDeviceOwner(serial, A, leaseId), false)
    applied(await b.setDeviceOwner(serial, A, 'automation', 'lease-a'), false)
    await retainsB(serial)
  }

  await seed('two-early-releases')
  applied(await a.releaseDeviceOwner('two-early-releases', A, 'lease-a'), false)
  applied(await b.releaseDeviceOwner('two-early-releases', B, 'lease-b'), false)
  applied(await a.setDeviceOwner('two-early-releases', A, 'automation', 'lease-a'), false)
  assert.equal((await read('two-early-releases')).owner, null)
  applied(await b.setDeviceOwner('two-early-releases', B, 'automation', 'lease-b'), false)
  assert.equal((await read('two-early-releases')).owner, null)

  // A delayed leave may report the same or a different user than the current reservation.
  await seed('different-owner')
  const other = {...B, email: 'other@example.test'}
  applied(await a.setDeviceOwner('different-owner', other, 'automation', 'lease-b'), true)
  applied(await b.releaseDeviceOwner('different-owner', A, 'lease-a'), false)
  assert.deepEqual((await read('different-owner')).owner, other)
  await retainsB('different-owner')

  // No reservation ID is the ordinary legacy email-only fallback, not a tombstone key.
  await seed('legacy')
  applied(await a.setDeviceOwner('legacy', owner(), 'debugging'), true)
  applied(await b.releaseDeviceOwner('legacy', owner()), true)
  assert.equal((await read('legacy')).owner, null)
  applied(await b.setDeviceOwner('legacy', owner(), 'debugging'), true)
  applied(await a.setDeviceOwner('legacy', owner()), true)
  assert.equal((await read('legacy')).usage, 'debugging', 'preserve upstream empty-usage semantics')
  await seed('legacy-empty-id', {owner: {...owner(), reservationId: ''}})
  applied(await b.releaseDeviceOwner('legacy-empty-id', owner()), true)
  assert.equal((await read('legacy-empty-id')).owner, null)
  applied(await a.releaseDeviceOwner('early-exact', owner()), false)
  await retainsB('early-exact')

  await seed('managed-to-manual', {usage: 'automation', automationLeaseId: 'stale-lease'})
  applied(await b.setDeviceOwner('managed-to-manual', owner()), true)
  const manual = await read('managed-to-manual')
  assert.equal(manual.automationLeaseId, null)
  assert.equal(manual.usage, null, 'a manual claim must clear stale managed usage')

  // Exercise the actual atomic updates through independent pooled connections and
  // through one connection, rather than a JavaScript approximation of ReQL terms.
  for (const peer of [a, b]) {
    for (let iteration = 0; iteration < 6; iteration++) {
      const serial = 'parallel-' + (peer === a ? 'same-' : 'pooled-') + iteration
      await seed(serial)
      applied(await a.setDeviceOwner(serial, A, 'automation', 'lease-a'), true)
      const results = await Promise.all([
        a.releaseDeviceOwner(serial, A, 'lease-a')
      , peer.setDeviceOwner(serial, B, 'automation', 'lease-b')
      ])
      results.forEach(stats => assert.equal(stats.errors, 0, stats.first_error))
      await retainsB(serial)
      assert.equal(await peer.hasDeviceAutomationRelease(serial, A.email, 'lease-a'), true)
      applied(await a.setDeviceOwner(serial, A, 'automation', 'lease-a'), false)
      await retainsB(serial)
    }
  }
  process.stdout.write('Device ownership integration passed against real RethinkDB.\n')
}
finally {
  await Promise.allSettled(connections.map(conn => conn.close()))
  try {
    if (created) {
      await r.dbDrop(database).run(root)
    }
  }
  finally {
    await root.close()
  }
}
