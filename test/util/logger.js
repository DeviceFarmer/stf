var chai = require('chai')
var expect = chai.expect
var sinon = require('sinon')

var logger = require('../../lib/util/logger')

describe('Logger', function() {
  it('should have a createLogger method', function() {
    expect(logger).itself.to.respondTo('createLogger')
  })

  it('should have a setGlobalIdentifier method', function() {
    expect(logger).itself.to.respondTo('setGlobalIdentifier')
  })

  it('should format and write every log level', function() {
    var output = sinon.stub(console, 'error')
    try {
      var log = logger.createLogger('dependency-check')
      ;['debug', 'verbose', 'info', 'important', 'warn', 'error', 'fatal']
        .forEach(function(level) {
          log[level]('message %s', level)
          expect(output.lastCall.args[0]).to.contain('dependency-check')
          expect(output.lastCall.args[0]).to.contain('message ' + level)
        })
    }
    finally {
      output.restore()
    }
  })
})
