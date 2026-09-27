import * as chai from 'chai'
var expect = chai.expect

import requtil from '../../lib/util/requtil.js'

type ValidationErrors = ConstructorParameters<typeof requtil.ValidationError>[1]

describe('requtil', function() {
  describe('ValidationError', function() {
    it('should carry its message', function() {
      var errors = [] as unknown as ValidationErrors
      var err = new requtil.ValidationError('validation error', errors)

      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.equal('validation error')
      expect(err.errors).to.equal(errors)
      expect(err.stack).to.match(/^ValidationError: validation error/)
    })
  })
})
