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
  function updateBody() {
    expect(lastUpdate[0], 'atomic update is a function of the device row').to.equal(69)
    return lastUpdate[1][1]
  }

  describe('setDeviceOwner', function() {
    it('should persist owner, usage and the automation fence atomically', function() {
      const owner = {email: 'runner@example.test', reservationId: 'reservation-a'} as DeviceOwner
      dbapi.setDeviceOwner('serial', owner, 'automation', 'lease-a')
      const [, pending, completed] = updateBody()[1]
      const [, cancelled, install] = completed[1]
      expect(install.owner).to.deep.equal(owner)
      expect(install.usage).to.equal('automation')
      expect(install.automationLeaseId).to.equal('lease-a')
      expect(install.restoreOwner).to.equal(null)
      expect(cancelled).to.deep.equal({})
      expect(pending).to.have.keys('pendingOwnerReleases', 'lastOwnerRelease')
      expect(pending).not.to.have.property('owner')
      expect(lastQuery[2]).to.include({durability: 'hard', return_changes: 'always'})
    })

    it('should clear stale managed usage and preserve ordinary empty-usage semantics', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner)
      const [managed, clear, preserve] = updateBody()[1]
      expect(JSON.stringify(managed)).to.include('automationLeaseId')
      expect(clear).to.include({automationLeaseId: null, usage: null, restoreOwner: null})
      expect(clear.owner.reservationId).to.equal(null)
      expect(preserve).to.include({automationLeaseId: null, restoreOwner: null})
      expect(preserve).not.to.have.property('usage')
      expect(preserve).not.to.have.property('usageChangedAt')
    })
  })

  describe('releaseDeviceOwner', function() {
    const owner = {email: 'runner@example.test', reservationId: 'reservation-a'} as DeviceOwner

    it('should retain an early leave separately from the actual ownership release', function() {
      dbapi.releaseDeviceOwner('serial', owner, 'lease-a')
      const [, release, unmatched] = updateBody()[1]
      expect(release).to.include({owner: null, automationLeaseId: null, usage: null})
      expect(release).to.have.property('automationRelease')
      expect(release).to.have.property('lastOwnerRelease')
      const [, duplicate, pending] = unmatched[1]
      expect(duplicate).to.deep.equal({})
      expect(pending).to.have.keys('pendingOwnerReleases')
      expect(pending).not.to.have.property('owner')
      expect(lastQuery[2]).to.include({durability: 'hard', return_changes: 'always'})
    })

    it('should keep legacy no-ID releases fenced by an absent automation lease', function() {
      dbapi.releaseDeviceOwner('serial', {email: owner.email} as DeviceOwner)
      const [matching, release, stale] = updateBody()[1]
      expect(JSON.stringify(matching)).to.include('automationLeaseId')
      expect(release).to.include({owner: null, automationLeaseId: null, usage: null})
      expect(stale).to.deep.equal({})
      expect(release).not.to.have.property('pendingOwnerReleases')
    })

    it('should find exact receipts in the latest and outstanding ownership records', function() {
      dbapi.hasDeviceAutomationRelease('serial', owner.email, 'lease-a')
      const query = JSON.stringify(lastQuery)
      for (const field of ['automationRelease', 'lastOwnerRelease', 'pendingOwnerReleases']) {
        expect(query).to.include(field)
      }
      expect(query).to.include(owner.email)
      expect(query).to.include('lease-a')
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
