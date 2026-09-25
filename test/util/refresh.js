var fs = require('fs')

var chai = require('chai')
var sinon = require('sinon')
var expect = chai.expect
chai.use(require('sinon-chai').default)

var refresh = require('../../lib/util/refresh')

describe('refresh', function() {
  afterEach(function() {
    sinon.restore()
  })

  it('should send SIGHUP to the current process when a watched file changes', function() {
    var watch = sinon.stub(fs, 'watch').returns({})
    var kill = sinon.stub(process, 'kill')

    refresh()

    expect(watch).to.have.been.called
    watch.firstCall.args[1]()
    expect(kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGHUP')
  })
})
