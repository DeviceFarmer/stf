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
  // Whether an older copy of the package is installed to begin with.
  installed?: boolean
  // What adbkit's uninstall() rejects with, if it does.
  uninstallError?: Error | null
  // Milliseconds before the transfer starts reading the source, like adbkit does once
  // its sync connection is open. Defaults to reading at once.
  readerDelay?: number
  // Whether the transfer emits 'end'. adbkit's never does on Node >= 16, so the plugin
  // must not depend on it.
  emitEnd?: boolean
}

// Mimics the adbkit calls the plugin makes against a device that keeps pushed files in
// `files`. Like adbkit's installRemote(), installing removes the APK from the device whether
// the install succeeds or fails, so installing again needs another push.
function createFakeDevice(bytes: Buffer, options: FakeDeviceOptions) {
  var files = new Map<string, Buffer>()
  var calls: string[] = []
  var transfers: Array<
    EventEmitter & {cancel: sinon.SinonSpy, stats: {bytesTransferred: number}}
  > = []
  var installs = 0
  var state = {installed: Boolean(options.installed)}

  var adb = {
    push: sinon.stub().callsFake(function(
      serial: string
    , source: Readable
    , destination: string
    ) {
      expect(serial).to.equal('test-device')
      calls.push('push ' + destination)
      var transfer = Object.assign(new EventEmitter(), {
        cancel: sinon.spy()
      , stats: {bytesTransferred: 0}
      })
      transfers.push(transfer)
      var chunks: Buffer[] = []
      function read() {
        source.on('data', function(chunk: Buffer) {
          chunks.push(chunk)
        })
        source.on('end', function() {
          var data = Buffer.concat(chunks)
          files.set(destination, data)
          transfer.stats.bytesTransferred = data.length
          transfer.emit('progress', transfer.stats)
          if (options.emitEnd !== false) {
            transfer.emit('end')
          }
        })
        source.on('error', function(err: Error) {
          transfer.emit('error', err)
        })
      }
      if (options.readerDelay) {
        setTimeout(read, options.readerDelay)
      }
      else {
        read()
      }
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
      if (code) {
        return Promise.reject({code: code})
      }
      state.installed = true
      return Promise.resolve(true)
    })
  , uninstall: sinon.stub().callsFake(function(serial: string, pkg: string) {
      calls.push('uninstall ' + pkg)
      if (options.uninstallError) {
        return Promise.reject(options.uninstallError)
      }
      state.installed = false
      return Promise.resolve(true)
    })
  }

  return {adb, calls, files, state, transfers}
}

describe('device APK transfer', function() {
  var server: http.Server, origin: string
  var bytes = Buffer.from([80, 75, 3, 4, 0, 255, 42])
  // HTTP status for each storage request in a test, 200 once they run out.
  var statuses: number[] = []
  // Like S3 behind a proxy: the body is chunked and has no Content-Length.
  var omitContentLength = false
  // Responses that never end, to destroy once the test is over.
  var hanging: http.ServerResponse[] = []
  var hangAfterFirstByte = false

  before(function(done) {
    server = http.createServer(function(req, res) {
      var status = statuses.shift() || 200
      var body = status === 200 ? bytes : Buffer.from('Not Found')
      res.statusCode = status
      if (hangAfterFirstByte) {
        res.setHeader('Content-Length', bytes.length)
        res.write(bytes.subarray(0, 1))
        hanging.push(res)
        return
      }
      if (omitContentLength) {
        // end(body) alone would make Node add the header; writing first keeps it chunked.
        res.write(body)
        res.end()
        return
      }
      res.setHeader('Content-Length', body.length)
      res.end(body)
    })
    server.listen(0, function() {
      origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/'
      done()
    })
  })

  beforeEach(function() {
    statuses = []
    omitContentLength = false
    hangAfterFirstByte = false
  })

  afterEach(function() {
    hanging.splice(0).forEach(function(res) {
      res.destroy()
    })
  })

  after(function(done) {
    server.close(done)
  })

  function install(adb: ReturnType<typeof createFakeDevice>['adb'], timeout = 1500) {
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

    return (timeout ? result.timeout(timeout) : result).then(function(response) {
      return {response, progress}
    })
  }

  // Drops the device path so call lists stay readable.
  function steps(calls: string[]) {
    return calls.map(function(call) {
      return call.replace(' ' + APK, '')
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

  // The whole body is in the first packet, so the download is over before adbkit has
  // opened its connection and starts reading.
  it('should push an APK that finished downloading before the transfer began reading',
    async function() {
      var device = createFakeDevice(bytes, {
        installErrors: [null]
      , readerDelay: 50
      , emitEnd: false
      })

      var {response} = await install(device.adb)
      expect(device.calls).to.deep.equal(['push ' + APK, 'install ' + APK])
      expect(response.success).to.equal(true)
    })

  it('should install when storage sends no Content-Length', async function() {
    omitContentLength = true
    var device = createFakeDevice(bytes, {installErrors: [null], emitEnd: false})

    var {response} = await install(device.adb)
    expect(device.calls).to.deep.equal(['push ' + APK, 'install ' + APK])
    expect(response.success).to.equal(true)
  })

  describe('when storage stops sending', function() {
    var clock: sinon.SinonFakeTimers

    beforeEach(function() {
      // Only the timers: the sockets keep running on the real event loop.
      clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    })

    afterEach(function() {
      clock.restore()
    })

    it('should give up with a timeout instead of waiting for ever', async function() {
      hangAfterFirstByte = true
      var device = createFakeDevice(bytes, {installErrors: [null], emitEnd: false})

      // No test timeout of its own: that would be a faked timer too.
      var result = install(device.adb, 0)
      while (!hanging.length) {
        await new Promise(setImmediate)
      }
      // Let the first byte reach the plugin.
      for (var i = 0; i < 20; i++) {
        await new Promise(setImmediate)
      }
      await clock.tickAsync(60000)

      var {response} = await result
      expect(device.calls).to.deep.equal(['push ' + APK])
      expect(device.transfers[0]!.cancel.called).to.equal(true)
      expect(response.success).to.equal(false)
      expect(response.data).to.equal('INSTALL_ERROR_TIMEOUT')
    })
  })

  it('should not push an error page from storage as the APK', async function() {
    statuses = [404]
    var device = createFakeDevice(bytes, {installErrors: [null]})

    var {response} = await install(device.adb)
    expect(steps(device.calls)).to.deep.equal(['push'])
    expect(device.adb.installRemote.called).to.equal(false)
    expect(device.transfers[0]!.cancel.called).to.equal(true)
    expect(response.success).to.equal(false)
    expect(response.data).to.equal('INSTALL_ERROR_DOWNLOAD')
  })

  ;[
    'INSTALL_FAILED_UPDATE_INCOMPATIBLE'
  , 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES'
  , 'INSTALL_FAILED_VERSION_DOWNGRADE'
  ].forEach(function(errorCode) {
    it('should push the APK again, uninstall and install again on ' + errorCode, async function() {
      var device = createFakeDevice(bytes, {installErrors: [errorCode, null], installed: true})

      var {response, progress} = await install(device.adb)
      expect(steps(device.calls)).to.deep.equal([
        'push', 'install', 'push', 'uninstall test.apk', 'install'
      ])
      expect(device.files.size).to.equal(0)
      expect(device.state.installed).to.equal(true)
      expect(response.success).to.equal(true)
      expect(response.data).to.equal('INSTALL_SUCCEEDED')
      // The second push must not send the progress back to pushing_app.
      var installing = progress.indexOf('installing_app')
      expect(installing).to.be.at.least(0)
      expect(progress.slice(installing)).to.not.include('pushing_app')
    })
  })

  it('should keep the old app when the second push fails', async function() {
    statuses = [200, 500]
    var device = createFakeDevice(bytes, {
      installErrors: ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', null]
    , installed: true
    })

    var {response} = await install(device.adb)
    expect(steps(device.calls)).to.deep.equal(['push', 'install', 'push'])
    expect(device.adb.uninstall.called).to.equal(false)
    expect(device.state.installed).to.equal(true)
    expect(response.success).to.equal(false)
    expect(response.data).to.equal('INSTALL_ERROR_DOWNLOAD')
  })

  ;[
    {
      name: 'the retry install fails again'
    , retryError: 'INSTALL_FAILED_INVALID_APK'
    , uninstallError: null
    , data: 'INSTALL_FAILED_INVALID_APK'
    , calls: ['push', 'install', 'push', 'uninstall test.apk', 'install']
    }
  , {
      name: 'the retry install is refused for the same reason'
    , retryError: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE'
    , uninstallError: null
    , data: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE'
    , calls: ['push', 'install', 'push', 'uninstall test.apk', 'install']
    }
  , {
      name: 'the uninstall fails'
    , retryError: null
      // The only uninstall failure adbkit rejects with; other failures resolve.
    , uninstallError: new Error(
        'test.apk could not be uninstalled [DELETE_FAILED_DEVICE_POLICY_MANAGER]')
    , data: 'INSTALL_ERROR_UNKNOWN'
    , calls: ['push', 'install', 'push', 'uninstall test.apk']
    }
  ].forEach(function(scenario) {
    it('should report failure when ' + scenario.name, async function() {
      var device = createFakeDevice(bytes, {
        installErrors: ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', scenario.retryError]
      , installed: true
      , uninstallError: scenario.uninstallError
      })

      var {response} = await install(device.adb)
      expect(steps(device.calls)).to.deep.equal(scenario.calls)
      expect(response.success).to.equal(false)
      expect(response.data).to.equal(scenario.data)
    })
  })
})
