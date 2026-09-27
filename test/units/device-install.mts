import EventEmitter from 'node:events'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Readable} from 'node:stream'

import {expect} from 'chai'
import Promise from 'bluebird'
import sinon from 'sinon'

import installSyrup from '../../lib/units/device/plugins/install.js'
import wire from '../../lib/wire/index.js'
import createRouter from '../../lib/wire/router.js'

type TransactionDone = ReturnType<typeof wire.TransactionDoneMessage.decode>

describe('device APK transfer', function() {
  var server: http.Server, origin: string
  var bytes = Buffer.from([80, 75, 3, 4, 0, 255, 42])

  before(function(done) {
    server = http.createServer(function(req, res) {
      res.setHeader('Content-Length', bytes.length)
      res.end(bytes)
    })
    server.listen(0, function() {
      origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/'
      done()
    })
  })

  after(function(done) {
    server.close(done)
  })

  ;[null, 'INSTALL_FAILED_INVALID_APK'].forEach(function(errorCode) {
    it('should stream the APK and report ' + (errorCode || 'success'), async function() {
      var chunks: Buffer[] = []
      var router = createRouter()
      var adb = {
        push: sinon.stub().callsFake(function(
          serial: string
        , source: Readable
        , destination: string
        ) {
          expect(serial).to.equal('test-device')
          expect(destination).to.equal('/data/local/tmp/_app.apk')
          var transfer = new EventEmitter()
          source.on('data', function(chunk: Buffer) {
            chunks.push(chunk)
          })
          source.on('end', function() {
            transfer.emit('end')
          })
          source.on('error', function(err: Error) {
            transfer.emit('error', err)
          })
          return Promise.resolve(transfer)
        })
      , installRemote: sinon.stub().callsFake(function() {
          return errorCode ? Promise.reject({code: errorCode}) : Promise.resolve()
        })
      }

      var result = new Promise<TransactionDone>(function(resolve) {
        installSyrup.invoke({serial: 'test-device', storageUrl: origin}, adb, router, {
          send: function(parts: Buffer[]) {
            var envelope = wire.Envelope.decode(parts[1]!)
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
