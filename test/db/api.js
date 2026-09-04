var chai = require('chai')
var expect = chai.expect

// Stub the db module in the require cache before lib/db/api pulls it in: requiring it for real
// connects to RethinkDB as it loads, and these tests only care about the document a write sends.
// A built update term is [UPDATE, [[target], {document}]], so the document is the last argument.
var dbPath = require.resolve('../../lib/db')
var lastUpdate = null

require.cache[dbPath] = {exports: {
  run: function(query) {
    lastUpdate = query.build()[1][1]
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
