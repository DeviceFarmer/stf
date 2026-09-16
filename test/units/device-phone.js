var Readable = require('stream').Readable

var expect = require('chai').expect
var Promise = require('bluebird')
var sinon = require('sinon')

var phone = require('../../lib/units/device/plugins/util/phone')

function agentOutput(text) {
  var out = new Readable()
  out._read = function() {
    out.push(text === null ? null : Buffer.from(text))
    out.push(null)
  }
  return out
}

function fetch(options) {
  var adb = {
    shell: sinon.stub().callsFake(function() {
      return options.shell ? options.shell() : Promise.resolve(agentOutput(''))
    })
  }
  var service = {
    getProperties: sinon.stub().resolves(options.fromService)
  }
  var result = phone.invoke(
    {serial: 'test-device'}
  , adb
  , {path: '/data/app/stf.apk', main: 'jp.co.cyberagent.stf.Agent'}
  , service
  )
  return result.then(function(properties) {
    return {properties: properties, adb: adb, service: service}
  })
}

describe('device phone info', function() {
  it('should take the identifiers the agent prints and ignore everything else',
    async function() {
      var run = await fetch({
        fromService: {network: 'LTE'}
      , shell: function() {
          return Promise.resolve(agentOutput([
            'Unable to read subscriber property: nope'
          , 'imei=867400022047199'
          , 'imsi=310260000000000'
          , 'iccid=89860318640220133897'
          , 'phoneNumber=+15551234567'
          , ''
          ].join('\n')))
        }
      })

      expect(run.properties).to.deep.equal({
        network: 'LTE'
      , imei: '867400022047199'
      , imsi: '310260000000000'
      , iccid: '89860318640220133897'
      , phoneNumber: '+15551234567'
      })

      var command = run.adb.shell.firstCall.args[1]
      expect(command).to.contain('--telephony')
      expect(command).to.contain('/data/app/stf.apk')
      expect(command).to.contain('jp.co.cyberagent.stf.Agent')
    })

  it('should leave the fields blank against an agent without the argument',
    async function() {
      var run = await fetch({
        fromService: {}
      , shell: function() {
          return Promise.resolve(
            agentOutput('Error: unknown argument --telephony\n')
          )
        }
      })

      expect(run.properties).to.deep.equal({})
    })

  it('should never overwrite what the service already answered',
    async function() {
      var run = await fetch({
        fromService: {imei: 'from-service'}
      , shell: function() {
          return Promise.resolve(agentOutput('imei=from-agent\nimsi=42\n'))
        }
      })

      expect(run.properties.imei).to.equal('from-service')
      expect(run.properties.imsi).to.equal('42')
    })

  it('should not ask the agent when the service answered everything',
    async function() {
      var complete = {
        imei: 'a'
      , imsi: 'b'
      , phoneNumber: 'c'
      , iccid: 'd'
      }
      var run = await fetch({fromService: complete})

      expect(run.adb.shell.called).to.equal(false)
      expect(run.properties).to.deep.equal(complete)
    })

  it('should keep the service properties when the agent cannot be run',
    async function() {
      var run = await fetch({
        fromService: {network: 'LTE'}
      , shell: function() {
          return Promise.reject(new Error('device offline'))
        }
      })

      expect(run.properties).to.deep.equal({network: 'LTE'})
    })
})
