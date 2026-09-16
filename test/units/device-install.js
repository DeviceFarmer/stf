var EventEmitter = require('events')
var http = require('http')

var expect = require('chai').expect
var Promise = require('bluebird')
var sinon = require('sinon')

var install = require('../../lib/units/device/plugins/install')
var wire = require('../../lib/wire')
var createRouter = require('../../lib/wire/router')

describe('device APK transfer', function() {
  var server, origin
  var bytes = Buffer.from([80, 75, 3, 4, 0, 255, 42])

  before(function(done) {
    server = http.createServer(function(req, res) {
      res.setHeader('Content-Length', bytes.length)
      res.end(bytes)
    })
    server.listen(0, function() {
      origin = 'http://127.0.0.1:' + server.address().port + '/'
      done()
    })
  })

  after(function(done) {
    server.close(done)
  })

  ;[null, 'INSTALL_FAILED_INVALID_APK'].forEach(function(errorCode) {
    it('should stream the APK and report ' + (errorCode || 'success'), async function() {
      var chunks = []
      var router = createRouter()
      var adb = {
        push: sinon.stub().callsFake(function(serial, source, destination) {
          expect(serial).to.equal('test-device')
          expect(destination).to.equal('/data/local/tmp/_app.apk')
          var transfer = new EventEmitter()
          source.on('data', function(chunk) {
            chunks.push(chunk)
          })
          source.on('end', function() {
            transfer.emit('end')
          })
          source.on('error', function(err) {
            transfer.emit('error', err)
          })
          return Promise.resolve(transfer)
        })
      , installRemote: sinon.stub().callsFake(function() {
          return errorCode ? Promise.reject({code: errorCode}) : Promise.resolve()
        })
      }

      var result = new Promise(function(resolve) {
        install.invoke({serial: 'test-device', storageUrl: origin}, adb, router, {
          send: function(parts) {
            var envelope = wire.Envelope.decode(parts[1])
            if (envelope.type === wire.TransactionDoneMessage.$code) {
              resolve(wire.TransactionDoneMessage.decode(envelope.message))
            }
          }
        })
      })

      router.emit(wire.InstallMessage.$code, 'test-channel', {
        href: '/sample.apk'
      , manifest: JSON.stringify({package: 'test.apk'})
      , launch: false
      })

      var response = await result.timeout(1500)
      expect(Buffer.concat(chunks)).to.deep.equal(bytes)
      expect(adb.installRemote.calledOnceWithExactly(
        'test-device', '/data/local/tmp/_app.apk'
      )).to.equal(true)
      expect(response.success).to.equal(!errorCode)
      expect(response.data).to.equal(errorCode || 'INSTALL_SUCCEEDED')
    })
  })
})
