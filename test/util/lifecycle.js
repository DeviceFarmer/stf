var chai = require('chai')
var expect = chai.expect

var lifecycle = require('../../lib/util/lifecycle')

describe('lifecycle', function() {
  describe('settle', function() {
    var observers
    var timeout
    var write

    beforeEach(function() {
      observers = lifecycle.observers
      timeout = lifecycle.shutdownTimeout
      lifecycle.observers = []
      lifecycle.shutdownTimeout = 200
      // These cases log on purpose, and the report is easier to read without it
      write = console.error
      console.error = function() {}
    })

    afterEach(function() {
      console.error = write
      lifecycle.observers = observers
      lifecycle.shutdownTimeout = timeout
    })

    it('should run every observer', function() {
      var ran = []
      lifecycle.observe(function() { ran.push('one') })
      lifecycle.observe(function() { return Promise.resolve(ran.push('two')) })

      return lifecycle.settle().then(function() {
        expect(ran).to.eql(['one', 'two'])
      })
    })

    // A unit that cannot shut down is worse than one that shuts down untidily, so each of these
    // has to leave rather than hold the process open
    it('should settle when an observer throws', function() {
      lifecycle.observe(function() { throw new Error('sync') })
      return lifecycle.settle()
    })

    it('should settle when an observer rejects', function() {
      lifecycle.observe(function() { return Promise.reject(new Error('async')) })
      return lifecycle.settle()
    })

    it('should give up on an observer that never settles', function() {
      var started = Date.now()
      var finished = false
      lifecycle.observe(function() {
        return new Promise(function() {}).then(function() { finished = true })
      })

      return lifecycle.settle().then(function() {
        // Wide on purpose. What matters is that it waited rather than skipping, and left rather
        // than hanging; pinning it to the exact timeout only buys a test that fails on a slow
        // runner or a millisecond of timer slop.
        expect(Date.now() - started).to.be.within(100, 2000)
        expect(finished).to.equal(false)
      })
    })

    it('should still run the others when one of them fails', function() {
      var ran = []
      lifecycle.observe(function() { throw new Error('sync') })
      lifecycle.observe(function() { ran.push('after') })

      return lifecycle.settle().then(function() {
        expect(ran).to.eql(['after'])
      })
    })
  })
})
