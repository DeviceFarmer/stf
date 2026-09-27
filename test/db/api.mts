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

mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
  run: function(query: {build(): any}) {
    // Only the first write of a call, so a function that reads the row back does not overwrite it
    if (lastUpdate === null) {
      lastUpdate = query.build()[1][1]
    }
    return Promise.resolve({skipped: 0})
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
    it('should drop any claim in the same write that records the owner', function() {
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'} as DeviceOwner)
      expect(lastUpdate.owner).to.deep.equal({email: 'user@example.com'})
      expect(lastUpdate.restoreOwner).to.equal(null)
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
