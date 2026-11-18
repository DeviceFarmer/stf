import * as chai from 'chai'
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
  describe('setDeviceOwner', function() {
    it('should drop any claim in the same write that records the owner', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner)
      expect(lastUpdate.owner).to.deep.equal({email: 'user@example.com'})
      expect(lastUpdate.restoreOwner).to.equal(null)
    })
  })

  // A leave that lands after someone has taken the device again must not hand it back as free.
  // The update is a function of the row, so run it against rows instead of reading its shape.
  describe('releaseDeviceOwner', function() {
    var leaver = {email: 'leaver@example.com', reservationId: 'r1'} as DeviceOwner

    function releaseFrom(owner: Record<string, unknown> | null | undefined, leaving = leaver) {
      lastUpdate = null
      dbapi.releaseDeviceOwner('serial', leaving)
      return evalUpdate(lastUpdate, owner === undefined ? {} : {owner})
    }

    it('should clear the owner and usage when the leaving reservation still holds the device',
      function() {
        var change = releaseFrom({email: 'leaver@example.com', reservationId: 'r1'})
        expect(change).to.include({owner: null, usage: null, logs_enabled: false})
        expect(change).to.have.property('usageChangedAt', NOW)
      })

    it('should leave the device alone once another user has taken it', function() {
      expect(releaseFrom({email: 'taker@example.com', reservationId: 'r2'})).to.deep.equal({})
    })

    it('should leave the device alone once the same user has taken it again', function() {
      expect(releaseFrom({email: 'leaver@example.com', reservationId: 'r2'})).to.deep.equal({})
    })

    it('should leave a free device alone', function() {
      expect(releaseFrom(null)).to.deep.equal({})
      expect(releaseFrom(undefined)).to.deep.equal({})
    })

    // Device workers from 3.9.0 and older send no reservationId, so neither side has one
    it('should match on the email alone when there is no reservation', function() {
      var oldLeaver = {email: 'leaver@example.com'} as DeviceOwner
      expect(releaseFrom({email: 'leaver@example.com'}, oldLeaver)).to.have.property('owner', null)
      expect(releaseFrom({email: 'taker@example.com'}, oldLeaver)).to.deep.equal({})
    })
  })

  describe('setDeviceReady', function() {
    it('should set ready and hand the device back with no owner', function() {
      dbapi.setDeviceReady('serial', 'channel')
      expect(lastUpdate.ready).to.equal(true)
      expect(lastUpdate.owner).to.equal(null)
    })

    it('should not drop a pending claim before it can be honoured', function() {
      dbapi.setDeviceReady('serial', 'channel')
      expect(lastUpdate).to.not.have.property('restoreOwner')
    })
  })

  describe('saveDeviceInitialState', function() {
    it('should not drop the pending claim of a device that is coming back', function() {
      dbapi.saveDeviceInitialState('serial', {
        provider: 'p', status: 3, statusTimeStamp: 0
      } as unknown as InitialState)
      expect(lastUpdate).to.not.have.property('restoreOwner')
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
