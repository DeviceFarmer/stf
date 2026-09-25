var chai = require('chai')
var expect = chai.expect

var requtil = require('../../lib/util/requtil')

describe('requtil', function() {
  describe('ValidationError', function() {
    it('should carry its message', function() {
      var errors = []
      var err = new requtil.ValidationError('validation error', errors)

      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.equal('validation error')
      expect(err.errors).to.equal(errors)
      expect(err.stack).to.match(/^ValidationError: validation error/)
    })
  })
})
