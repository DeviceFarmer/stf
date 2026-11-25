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

// Evaluates a built update function against a row, for the few terms a conditional update uses.
// Anything else throws, so a query that grows past this fails the test instead of passing it.
var NOW = {now: true}
var VAR = 10
var EQ = 17
var NE = 18
var BRANCH = 65
var AND = 67
var FUNC = 69
var DEFAULT = 92
var NOW_TERM = 103
var BRACKET = 170
class Missing extends Error {}

function evalTerm(term: any, vars: Record<number, unknown>): any {
  if (term === null || typeof term !== 'object') {
    return term
  }
  if (!Array.isArray(term)) {
    return Object.fromEntries(Object.entries(term).map(([k, v]) => [k, evalTerm(v, vars)]))
  }
  var [type, args] = term
  switch (type) {
  case VAR: return vars[args[0]]
  case NOW_TERM: return NOW
  case BRACKET: {
    var target = evalTerm(args[0], vars)
    if (target === null || typeof target !== 'object' || !(args[1] in target)) {
      throw new Missing()
    }
    return target[args[1]]
  }
  case DEFAULT:
    try {
      var value = evalTerm(args[0], vars)
      return value === null ? evalTerm(args[1], vars) : value
    }
    catch (err) {
      if (err instanceof Missing) {
        return evalTerm(args[1], vars)
      }
      throw err
    }
  case EQ: return evalTerm(args[0], vars) === evalTerm(args[1], vars)
  case NE: return evalTerm(args[0], vars) !== evalTerm(args[1], vars)
  case AND: return args.every((arg: any) => evalTerm(arg, vars) === true)
  case BRANCH:
    return evalTerm(args[0], vars) === true ? evalTerm(args[1], vars) : evalTerm(args[2], vars)
  default: throw new Error(`Unsupported term ${type}`)
  }
}

function evalUpdate(update: any, row: Record<string, unknown>) {
  expect(update[0], 'update should be a function of the row').to.equal(FUNC)
  var [[, [id]], body] = update[1]
  return evalTerm(body, {[id]: row})
}

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
      expect(install.ownerTimeout).to.equal(null)
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
      expect(clear).to.include({
        automationLeaseId: null, usage: null, ownerTimeout: null, restoreOwner: null
      })
      expect(clear.owner.reservationId).to.equal(null)
      expect(preserve).to.include({automationLeaseId: null, restoreOwner: null})
      expect(preserve).not.to.have.property('usage')
      expect(preserve).not.to.have.property('usageChangedAt')
    })

    it('should record the timeout the reservation asked for', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner, 'automation'
      , null, 180000)
      const install = updateBody()
      expect(install).to.include({usage: 'automation', ownerTimeout: 180000})
    })
  })

  describe('releaseDeviceOwner', function() {
    const owner = {email: 'runner@example.test', reservationId: 'reservation-a'} as DeviceOwner

    it('should retain an early leave separately from the actual ownership release', function() {
      dbapi.releaseDeviceOwner('serial', owner, 'lease-a')
      const [, release, unmatched] = updateBody()[1]
      expect(release).to.include({
        owner: null, automationLeaseId: null, usage: null, ownerTimeout: null
      })
      expect(release).to.have.property('automationRelease')
      expect(release).to.have.property('lastOwnerRelease')
      const [, duplicate, pending] = unmatched[1]
      expect(duplicate).to.deep.equal({})
      expect(pending).to.have.keys('pendingOwnerReleases')
      expect(pending).not.to.have.property('owner')
      expect(lastQuery[2]).to.include({durability: 'hard', return_changes: 'always'})
    })

    it('should match a legacy owner by email only when no reservation or managed lease exists',
      function() {
        dbapi.releaseDeviceOwner('serial', {email: owner.email} as DeviceOwner)
        for (const current of [
          {email: owner.email}
        , {email: owner.email, reservationId: null}
        , {email: owner.email, reservationId: ''}
        ]) {
          const change = evalUpdate(lastUpdate, {owner: current})
          expect(change).to.include({owner: null, automationLeaseId: null, usage: null
            , logs_enabled: false, usageChangedAt: NOW})
        }
        for (const row of [
          {}, {owner: null}, {owner: {email: 'other@example.test'}}
        , {owner: {email: owner.email, reservationId: 'another-reservation'}}
        , {owner: {email: owner.email}, automationLeaseId: 'managed'}
        ]) {
          expect(evalUpdate(lastUpdate, row)).to.deep.equal({})
        }
      })

    // A claim is taken when a reboot that keeps ownership is requested. If the owner lets go
    // instead, the claim must end too, or nobody else can take the device for 2 minutes
    it('should end a reboot claim on a release that is not the device going away', function() {
      // An owner with no reservation keeps the update to the terms evalUpdate understands
      const legacy = {email: owner.email} as DeviceOwner
      const claim = {email: owner.email, expiresAt: 1}
      const row = {owner: {email: owner.email}, restoreOwner: claim}
      for (const reason of ['ungroup_request', 'automatic_timeout']) {
        lastUpdate = null
        dbapi.releaseDeviceOwner('serial', legacy, null, reason)
        expect(evalUpdate(lastUpdate, row)).to.include({owner: null, restoreOwner: null})
      }
      for (const reason of ['device_absent', undefined]) {
        lastUpdate = null
        dbapi.releaseDeviceOwner('serial', legacy, null, reason)
        expect(evalUpdate(lastUpdate, row).restoreOwner).to.deep.equal(claim)
      }
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

    it('should claim the device with the usage and timeout of its reservation', function() {
      dbapi.reserveDeviceOwner('serial')
      const change = evalUpdate(lastUpdate, {
        owner: {email: 'user@example.com'}, usage: 'automation', ownerTimeout: 180000
      })
      expect(change.restoreOwner).to.include({
        email: 'user@example.com', usage: 'automation', timeout: 180000
      })
      expect(change.restoreOwner.expiresAt).to.be.a('number')
    })

    it('should claim a reservation on the provider default with no timeout', function() {
      dbapi.reserveDeviceOwner('serial')
      const change = evalUpdate(lastUpdate, {owner: {email: 'user@example.com'}})
      expect(change.restoreOwner).to.include({usage: null, timeout: null})
    })
  })

  const manualRestoreClaim = built(r.branch(r.row('automationLeaseId').default(null).eq(null)
    , r.row('restoreOwner').default(null), null))

  describe('setDeviceReady', function() {
    it('should set ready and hand the device back with no owner', function() {
      dbapi.setDeviceReady('serial', 'channel')
      const update = lastUpdate[1][1]
      expect(update.ready).to.equal(true)
      expect(update).to.include({
        owner: null, automationLeaseId: null, usage: null, ownerTimeout: null
      })
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
      expect(update.ownerTimeout).to.equal(null)
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
