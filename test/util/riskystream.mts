import stream from 'node:stream'

import * as chai from 'chai'
var expect = chai.expect

import RiskyStream from '../../lib/util/riskystream.js'

describe('RiskyStream', function() {
  it('should resolve waitForEnd when the stream has already ended', function(done) {
    var source = new stream.PassThrough()
    var risky = new RiskyStream(source)

    risky.on('end', function() {
      risky.waitForEnd()
        .timeout(100)
        .then(function(ended) {
          expect(ended).to.equal(true)
          done()
        })
        .catch(done)
    })

    source.end()
    source.resume()
  })

  it('should resolve waitForEnd once the stream ends', function() {
    var source = new stream.PassThrough()
    var risky = new RiskyStream(source)
    var waiting = risky.waitForEnd()

    source.end()

    return waiting.then(function(ended) {
      expect(ended).to.equal(true)
    })
  })
})
