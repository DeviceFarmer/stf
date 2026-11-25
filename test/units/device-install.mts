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

var APK = '/data/local/tmp/_app.apk'

interface FakeDeviceOptions {
  // One entry per installRemote() call: an error code to fail with, or null to succeed.
  installErrors: Array<string | null>
  uninstallError?: string | null
}

// Mimics the adbkit calls the plugin makes against a device that keeps pushed files in
// `files`. Like adbkit's installRemote(), installing removes the APK from the device whether
// the install succeeds or fails, so installing again needs another push.
function createFakeDevice(bytes: Buffer, options: FakeDeviceOptions) {
  var files = new Map<string, Buffer>()
  var calls: string[] = []
  var installs = 0

  var adb = {
    push: sinon.stub().callsFake(function(
      serial: string
    , source: Readable
    , destination: string
    ) {
      expect(serial).to.equal('test-device')
      calls.push('push ' + destination)
      var transfer = new EventEmitter()
      var chunks: Buffer[] = []
      source.on('data', function(chunk: Buffer) {
        chunks.push(chunk)
      })
      source.on('end', function() {
        var data = Buffer.concat(chunks)
        files.set(destination, data)
        transfer.emit('progress', {bytesTransferred: data.length, bytesTotal: data.length})
        transfer.emit('end')
      })
      source.on('error', function(err: Error) {
        transfer.emit('error', err)
      })
      return Promise.resolve(transfer)
    })
  , stat: sinon.stub().callsFake(function(serial: string, path: string) {
      var data = files.get(path)
      return data ?
        Promise.resolve({size: data.length}) :
        Promise.reject(new Error('No such file: ' + path))
    })
  , installRemote: sinon.stub().callsFake(function(serial: string, apk: string) {
      calls.push('install ' + apk)
      var data = files.get(apk)
      files.delete(apk)
      if (!data) {
        return Promise.reject({code: 'INSTALL_EXCEPTION', message: 'Can\'t open file: ' + apk})
      }
      expect(data).to.deep.equal(bytes)
      var code = options.installErrors[installs++]
      return code ? Promise.reject({code: code}) : Promise.resolve(true)
    })
  , uninstall: sinon.stub().callsFake(function(serial: string, pkg: string) {
      calls.push('uninstall ' + pkg)
      return options.uninstallError ?
        Promise.reject({code: options.uninstallError}) :
        Promise.resolve(true)
    })
  }

  return {adb, calls, files}
}

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

  function install(adb: ReturnType<typeof createFakeDevice>['adb']) {
    var router = createRouter()
    var progress: string[] = []
    var result = new Promise<TransactionDone>(function(resolve) {
      installSyrup.invoke({serial: 'test-device', storageUrl: origin}, adb, router, {
        send: function(parts: Buffer[]) {
          var envelope = wire.Envelope.decode(parts[1]!)
          if (envelope.type === wire.TransactionProgressMessage.$code) {
            progress.push(wire.TransactionProgressMessage.decode(envelope.message).data!)
          }
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

    return result.timeout(1500).then(function(response) {
      return {response, progress}
    })
  }

  [null, 'INSTALL_FAILED_INVALID_APK'].forEach(function(errorCode) {
    it('should stream the APK and report ' + (errorCode || 'success'), async function() {
      var device = createFakeDevice(bytes, {installErrors: [errorCode]})

      var {response} = await install(device.adb)
      expect(device.calls).to.deep.equal(['push ' + APK, 'install ' + APK])
      expect(device.adb.installRemote.calledOnceWithExactly('test-device', APK)).to.equal(true)
      expect(device.files.size).to.equal(0)
      expect(response.success).to.equal(!errorCode)
      expect(response.data).to.equal(errorCode || 'INSTALL_SUCCEEDED')
    })
  })

  ;[
    'INSTALL_FAILED_UPDATE_INCOMPATIBLE'
  , 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES'
  , 'INSTALL_FAILED_VERSION_DOWNGRADE'
  ].forEach(function(errorCode) {
    it('should uninstall, push the APK again and install again on ' + errorCode, async function() {
      var device = createFakeDevice(bytes, {installErrors: [errorCode, null]})

      var {response, progress} = await install(device.adb)
      expect(device.calls).to.deep.equal([
        'push ' + APK
      , 'install ' + APK
      , 'uninstall test.apk'
      , 'push ' + APK
      , 'install ' + APK
      ])
      expect(device.files.size).to.equal(0)
      expect(response.success).to.equal(true)
      expect(response.data).to.equal('INSTALL_SUCCEEDED')
      // The second push must not send the progress back to pushing_app.
      expect(progress.slice(progress.indexOf('installing_app'))).to.not.include('pushing_app')
    })
  })

  ;[
    {
      name: 'the retry install fails again'
    , uninstallError: null
    , data: 'INSTALL_FAILED_INVALID_APK'
    , calls: ['push', 'install', 'uninstall test.apk', 'push', 'install']
    }
  , {
      name: 'the uninstall fails'
    , uninstallError: 'DELETE_FAILED_INTERNAL_ERROR'
    , data: 'INSTALL_ERROR_UNKNOWN'
    , calls: ['push', 'install', 'uninstall test.apk']
    }
  ].forEach(function(scenario) {
    it('should report failure when ' + scenario.name, async function() {
      var device = createFakeDevice(bytes, {
        installErrors: ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', 'INSTALL_FAILED_INVALID_APK']
      , uninstallError: scenario.uninstallError
      })

      var {response} = await install(device.adb)
      expect(device.calls.map(function(call) {
        return call.replace(' ' + APK, '')
      })).to.deep.equal(scenario.calls)
      expect(response.success).to.equal(false)
      expect(response.data).to.equal(scenario.data)
    })
  })
})
