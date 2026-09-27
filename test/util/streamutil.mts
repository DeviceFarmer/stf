import * as chai from 'chai'
var expect = chai.expect

import streamutil from '../../lib/util/streamutil.js'

describe('streamutil', function() {
  describe('NoSuchLineError', function() {
    it('should carry its message', function() {
      var err = new streamutil.NoSuchLineError('no such line')

      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.equal('no such line')
      expect(err.stack).to.match(/^NoSuchLineError: no such line/)
    })
  })
})
