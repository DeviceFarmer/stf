var chai = require('chai')
var expect = chai.expect

// Stub the db module in the require cache before lib/db/api pulls it in: requiring it for real
// connects to RethinkDB as it loads, and these tests only care about the document a write sends.
// A built update term is [UPDATE, [[target], {document}]], so the document is the last argument.
var dbPath = require.resolve('../../lib/db')
var lastUpdate = null

require.cache[dbPath] = {exports: {
  run: function(query) {
    // Only the first write of a call, so a function that reads the row back does not overwrite it
    if (lastUpdate === null) {
      lastUpdate = query.build()[1][1]
    }
    return Promise.resolve({skipped: 0})
  }
}}

var dbapi = require('../../lib/db/api')

describe('dbapi device presence', function() {
  beforeEach(function() {
    lastUpdate = null
  })

  describe('setDeviceAbsent', function() {
    it('should clear ready so a departed device stops reporting itself as ready', function() {
      dbapi.setDeviceAbsent('serial')
      expect(lastUpdate.present).to.equal(false)
      expect(lastUpdate.ready).to.equal(false)
    })
  })

  describe('setDevicePresent', function() {
    // Deliberately asymmetric: only a device worker reaching "Fully operational" may set ready,
    // so marking a device present must not guess at it.
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
      dbapi.setDeviceOwner('serial', {email: 'user@example.com'})
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
      dbapi.saveDeviceInitialState('serial', {provider: 'p', status: 3, statusTimeStamp: 0})
      expect(lastUpdate).to.not.have.property('restoreOwner')
    })
  })
})
