var Readable = require('stream').Readable
var childProcess = require('child_process')
var fs = require('fs')
var os = require('os')
var path = require('path')

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
    shell: sinon.stub().callsFake(function(serial, command) {
      return options.shell ? options.shell(command) :
        Promise.resolve(agentOutput(''))
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

function runShell(uid, command) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-phone-'))
  var scripts = {
    id: 'printf "%s\\n" "$STF_TEST_UID"\n'
  , su: '[ "$1" = shell ] || exit 1\n' +
      'shift\nSTF_TEST_UID=2000 exec "$@"\n'
  , app_process: '[ "$STF_TEST_UID" = 2000 ] || exit 1\n' +
      '[ "$CLASSPATH" = /data/app/stf.apk ] || exit 1\n' +
      '[ "$*" = "/system/bin jp.co.cyberagent.stf.Agent --telephony" ]' +
      ' || exit 1\n' +
      'printf "imei=a\\nimsi=b\\nphoneNumber=c\\niccid=d\\n"\n'
  }
  try {
    Object.keys(scripts).forEach(function(name) {
      fs.writeFileSync(path.join(directory, name), scripts[name], {mode: 0o755})
    })
    var result = childProcess.spawnSync('/bin/sh', ['-c', command], {
      env: Object.assign({}, process.env, {
        PATH: directory
      , STF_TEST_UID: String(uid)
      })
    , encoding: 'utf8'
    })
    expect(result.status).to.equal(0, result.stderr)
    return result.stdout
  }
  finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('device phone info', function() {
  [0, 2000].forEach(function(uid) {
    it('should query as the shell user when ADB uses UID ' + uid,
      async function() {
        var run = await fetch({
          fromService: {}
        , shell: function(command) {
            return Promise.resolve(agentOutput(runShell(uid, command)))
          }
        })

        expect(run.properties).to.deep.equal({
          imei: 'a'
        , imsi: 'b'
        , phoneNumber: 'c'
        , iccid: 'd'
        })
      })
  })

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
