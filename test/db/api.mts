import * as chai from 'chai'
import r from 'rethinkdb'
var expect = chai.expect

import type DbApi from '../../lib/db/api.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

type DeviceOwner = Parameters<typeof DbApi.setDeviceOwner>[1]
type InitialState = Parameters<typeof DbApi.saveDeviceInitialState>[1]

// Stub the db module before lib/db/api pulls it in: importing it for real
// connects to RethinkDB as it loads, and these tests only care about the document a write sends.
// A built update term is [UPDATE, [[target], {document}]], so the document is the last argument.
var lastUpdate: any = null
var lastQuery: any = null

function built(query: unknown): unknown {
  return (query as {build(): unknown}).build()
}

mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
  run: function(query: {build(): any}) {
    lastQuery = query.build()
    // Only the first write of a call, so a function that reads the row back does not overwrite it
    if (lastUpdate === null) {
      lastUpdate = query.build()[1][1]
    }
    return Promise.resolve({skipped: 0, toArray: () => Promise.resolve([])})
  }
}})

var dbapi: typeof DbApi =
  (await importFresh(new URL('../../lib/db/api.js', import.meta.url))).default

describe('dbapi device presence', function() {
  beforeEach(function() {
    lastUpdate = null
  })

  describe('setDeviceAbsent', function() {
    it('should not touch ready', function() {
      dbapi.setDeviceAbsent('serial')
      expect(lastUpdate.present).to.equal(false)
      expect(lastUpdate).to.not.have.property('ready')
    })
  })

  describe('setDevicePresent', function() {
    it('should not touch ready', function() {
      dbapi.setDevicePresent('serial')
      expect(lastUpdate.present).to.equal(true)
      expect(lastUpdate).to.not.have.property('ready')
    })
  })
})

describe('dbapi owner claim', function() {
  beforeEach(function() {
    lastUpdate = null
  })

  describe('clearDeviceRestoreOwner', function() {
    it('should drop the claim', function() {
      dbapi.clearDeviceRestoreOwner('serial')
      expect(lastUpdate.restoreOwner).to.equal(null)
    })
  })

  // A claim is written when the device leaves and read when it is ready again, so every write in
  // between has to leave it alone. Both of these run in that window on every reboot.
  // The claim has to go when the device is taken, or a reboot that never happened could hand the
  // device back to an earlier user later. It rides the write that records the new owner.
  describe('setDeviceOwner', function() {
    it('should persist the automation fence and usage with its owner', function() {
      const owner = {email: 'runner@example.test', reservationId: 'reservation-a'} as DeviceOwner
      dbapi.setDeviceOwner('serial', owner, 'lease-a', 'automation')
      expect(lastUpdate.automationLeaseId).to.equal('lease-a')
      expect(lastUpdate.owner).to.deep.equal(owner)
      expect(lastUpdate.usage).to.equal('automation')
    })

    it('should clear a previous fence and usage for legacy or manual ownership', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner)
      expect(lastUpdate.automationLeaseId).to.equal(null)
      expect(lastUpdate.usage).to.equal(null)
      expect(lastUpdate.owner.reservationId).to.equal(null)
    })

    it('should drop any claim in the same write that records the owner', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner)
      expect(lastUpdate.restoreOwner).to.equal(null)
    })
  })

  describe('unsetDeviceOwner', function() {
    const owner = {email: 'runner@example.test', reservationId: 'reservation-a'} as DeviceOwner
    const currentOwner = r.row('owner').default({})
    const leaseId = r.row('automationLeaseId').default(null)
    const ownerMatches = currentOwner('email').default(null).eq(owner.email)

    it('should clear the matching reservation and write its durable receipt', function() {
      dbapi.unsetDeviceOwner('serial', owner)
      const [matches, release, stale] = lastUpdate[1][1][1]
      expect(matches).to.deep.equal(built(ownerMatches
        .and(currentOwner('reservationId').default(null).eq(owner.reservationId))))
      expect(stale).to.deep.equal({})
      expect(release).to.include({owner: null, automationLeaseId: null, usage: null})
      expect(release.automationRelease).to.deep.equal(built(r.branch(leaseId.ne(null)
        , {email: owner.email, leaseId}, r.row('automationRelease').default(null))))
      expect(lastQuery[2].durability).to.equal('hard')
    })

    it('should only release an unmanaged legacy owner if the event has no reservation ID',
      function() {
        dbapi.unsetDeviceOwner('serial', {email: owner.email} as DeviceOwner)
        const [matches, , stale] = lastUpdate[1][1][1]
        expect(matches).to.deep.equal(built(ownerMatches
          .and(currentOwner('reservationId').default(null).eq(null)).and(leaseId.eq(null))))
        expect(stale).to.deep.equal({})
      })

    it('should look up only an exact release receipt', function() {
      dbapi.hasDeviceAutomationRelease('serial', owner.email, 'lease-a')
      expect(lastQuery).to.deep.equal(built(r.table('devices').getAll('serial')
        .filter({automationRelease: {email: owner.email, leaseId: 'lease-a'}}).isEmpty().not()))
    })
  })

  describe('reserveDeviceOwner', function() {
    it('should drop rather than record a restore claim for a managed lease', function() {
      dbapi.reserveDeviceOwner('serial')
      const [managed, clear, manual] = lastUpdate[1][1][1]
      expect(managed[1][0][1][0][1][1]).to.equal('automationLeaseId')
      expect(managed[1][1]).to.equal(null)
      expect(clear).to.deep.equal({restoreOwner: null})
      expect(manual[1][2].restoreOwner).to.have.property('email')
    })
  })

  const manualRestoreClaim = built(r.branch(r.row('automationLeaseId').default(null).eq(null)
    , r.row('restoreOwner').default(null), null))

  describe('setDeviceReady', function() {
    it('should set ready and hand the device back with no owner', function() {
      dbapi.setDeviceReady('serial', 'channel')
      const update = lastUpdate[1][1]
      expect(update.ready).to.equal(true)
      expect(update).to.include({owner: null, automationLeaseId: null, usage: null})
    })

    it('should preserve a pending manual claim without restoring a managed lease', function() {
      dbapi.setDeviceReady('serial', 'channel')
      expect(lastUpdate[1][1].restoreOwner).to.deep.equal(manualRestoreClaim)
    })
  })

  describe('saveDeviceInitialState', function() {
    it('should preserve a pending manual claim and clear a stale managed lease', function() {
      dbapi.saveDeviceInitialState('serial', {
        provider: 'p', status: 3, statusTimeStamp: 0
      } as unknown as InitialState)
      const update = lastUpdate[1][1]
      expect(update.automationLeaseId).to.equal(null)
      expect(update.restoreOwner).to.deep.equal(manualRestoreClaim)
    })
  })
})

describe('dbapi adb keys', function() {
  beforeEach(function() {
    lastUpdate = null
  })

  // The document is built per row, so the entry sits inside the function term as the argument of
  // the append: [FUNC, [args, {adbKeys: [APPEND, [keys, entry]]}]]
  function appendedEntry() {
    return lastUpdate[1][1].adbKeys[1][1]
  }

  describe('insertUserAdbKey', function() {
    it('should keep the full key along with the fingerprint', function() {
      dbapi.insertUserAdbKey('email', {title: 'title', fingerprint: 'fp', publicKey: 'key'})
      expect(appendedEntry()).to.deep.equal({title: 'title', fingerprint: 'fp', publicKey: 'key'})
    })

    // The driver refuses undefined fields, so the field has to be left out rather than empty
    it('should leave the full key out when there is none', function() {
      dbapi.insertUserAdbKey('email', {title: 'title', fingerprint: 'fp'})
      expect(appendedEntry()).to.deep.equal({title: 'title', fingerprint: 'fp'})
    })
  })
})


describe('dbapi device channel resolution', function() {
  it('uses the channel index and applies group visibility', async function() {
    const tables = (await import('../../lib/db/tables.js')).default
    expect(tables.devices!.indexes).to.have.property('channel')
    const result = await dbapi.loadDeviceByChannel('private-channel', ['shared-group'])
    expect(result).to.equal(null)
    // Inspect the driver's actual query tree: LIMIT(FILTER(GET_ALL(..., index: channel))).
    expect(lastQuery[0]).to.equal(71)
    const filter = lastQuery[1][0]
    expect(filter[0]).to.equal(39)
    const getAll = filter[1][0]
    expect(getAll[0]).to.equal(78)
    expect(getAll[1][1]).to.equal('private-channel')
    expect(getAll[2]).to.deep.equal({index: 'channel'})
    expect(JSON.stringify(filter[1][1])).to.include('shared-group')
    expect(lastQuery[1][1]).to.equal(1)
  })
})
