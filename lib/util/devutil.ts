import util from 'util'

import split from 'split'
import Promise from 'bluebird'
import androidDeviceList from 'android-device-list'
import type {Properties} from '@devicefarmer/adbkit'
import type {Duplex, Readable} from 'stream'
import type adbutil from './adbutil.js'

type Adb = ReturnType<typeof adbutil>

type LocalSocket = Duplex & {sock: string}

interface ProcessList {
  showTotalPid: boolean
  pids: number[]
}

interface Identity {
  serial: string
  platform: string
  manufacturer: string
  operator: string | null
  model: string
  version: string | undefined
  abi: string | undefined
  sdk: string | undefined
  product: string | undefined
  cpuPlatform: string | undefined
  openGLESVersion: string
  marketName: string | undefined
}

interface DevUtil {
  ensureUnusedLocalSocket(adb: Adb, serial: string, sock: string): Promise<string>
  waitForLocalSocket(adb: Adb, serial: string, sock: string): Promise<LocalSocket>
  listPidsByComm(
    adb: Adb
  , serial: string
  , comm: string
  , bin: string
  , mode?: number
  ): Promise<number[]>
  waitForProcsToDie(adb: Adb, serial: string, comm: string, bin: string): Promise<void>
  killProcsByComm(adb: Adb, serial: string, comm: string, bin: string, mode?: number): Promise<void>
  makeIdentity(serial: string, properties: Properties): Identity
}

var devutil: DevUtil = Object.create(null)

function closedError(err: Error) {
  return err.message.indexOf('closed') !== -1
}

devutil.ensureUnusedLocalSocket = function(adb: Adb, serial: string, sock: string) {
  return adb.openLocal(serial, sock)
    .then(function(conn) {
      conn.end()
      throw new Error(util.format('Local socket "%s" should be unused', sock))
    })
    .catch(closedError, function() {
      return Promise.resolve(sock)
    })
}

devutil.waitForLocalSocket = function(
  adb: Adb
, serial: string
, sock: string
): Promise<LocalSocket> {
  return adb.openLocal(serial, sock)
    .then(function(conn) {
      (conn as LocalSocket).sock = sock
      return conn as LocalSocket
    })
    .catch(closedError, function() {
      return Promise.delay(100)
        .then(function() {
          return devutil.waitForLocalSocket(adb, serial, sock)
        })
    })
}

devutil.listPidsByComm = function(adb: Adb, serial: string, comm: string, bin: string) {
  var users: Record<string, boolean> = {
    shell: true
  }

  var findProcess = function(out: Readable) {
    return new Promise<ProcessList>(function(resolve) {
      var header = true
      var pids: number[] = []
      var showTotalPid = false

      out.pipe(split())
        .on('data', function(chunk: Buffer | string) {
          if (header) {
            header = false
          }
          else {
            var cols = chunk.toString().split(/\s+/)
            if (!showTotalPid && cols[0] === 'root') {
              showTotalPid = true
            }

            // last column of output would be command name containing absolute path like '/data/local/tmp/minicap'
            // or just binary name like 'minicap', it depends on device/ROM
            var lastCol = cols.pop()
            if ((lastCol === comm || lastCol === bin) && users[cols[0]!]) {
              pids.push(Number(cols[1]))
            }
          }
        })
        .on('end', function() {
          resolve({showTotalPid: showTotalPid, pids: pids})
        })
    })
  }

  return adb.shell(serial, 'ps 2>/dev/null')
     .then(findProcess)
     .then(function(res) {
       // return pids if process can be found in the output of 'ps' command
       // or 'ps' command has already displayed all the processes including processes launched by root user
       if (res.showTotalPid || res.pids.length > 0) {
         return Promise.resolve(res.pids)
       }
       // otherwise try to run 'ps -elf'
       else {
         return adb.shell(serial, 'ps -lef 2>/dev/null')
           .then(findProcess)
           .then(function(res) {
              return Promise.resolve(res.pids)
           })
       }
     })
}

devutil.waitForProcsToDie = function(
  adb: Adb
, serial: string
, comm: string
, bin: string
): Promise<void> {
  return devutil.listPidsByComm(adb, serial, comm, bin)
    .then(function(pids) {
      if (pids.length) {
        return Promise.delay(100)
          .then(function() {
            return devutil.waitForProcsToDie(adb, serial, comm, bin)
          })
      }
      return Promise.resolve()
    })
}

devutil.killProcsByComm = function(
  adb: Adb
, serial: string
, comm: string
, bin: string
, mode?: number
): Promise<void> {
  return devutil.listPidsByComm(adb, serial, comm, bin, mode)
    .then(function(pids) {
      if (!pids.length) {
        return Promise.resolve()
      }
      return adb.shell(serial, ['kill', mode || -15].concat(pids))
        .then(function(out) {
          return new Promise<void>(function(resolve) {
            out.on('end', resolve)
          })
        })
        .then(function() {
          return devutil.waitForProcsToDie(adb, serial, comm, bin)
        })
        .timeout(2000)
        .catch(function() {
          return devutil.killProcsByComm(adb, serial, comm, bin, -9)
        })
    })
}

devutil.makeIdentity = function(serial: string, properties: Properties) {
  var model = properties['ro.product.model'] || ''
  var brand = properties['ro.product.brand']
  var manufacturer = properties['ro.product.manufacturer'] || ''
  var operator = properties['gsm.sim.operator.alpha'] ||
        properties['gsm.operator.alpha']
  var version = properties['ro.build.version.release']
  var sdk = properties['ro.build.version.sdk']
  var abi = properties['ro.product.cpu.abi']
  var product = properties['ro.product.name']
  var cpuPlatform = properties['ro.board.platform']
  var openGLESVersion: string | number = properties['ro.opengles.version']!
  var marketName = properties['ro.product.device']
  var customMarketName = properties['debug.stf.product.device']

  openGLESVersion = parseInt(openGLESVersion, 10)
  if (isNaN(openGLESVersion)) {
    openGLESVersion = '0.0'
  }
  else {
    var openGLESVersionMajor = (openGLESVersion & 0xffff0000) >> 16
    var openGLESVersionMinor = (openGLESVersion & 0xffff)
    openGLESVersion = openGLESVersionMajor + '.' + openGLESVersionMinor
  }

  // Remove brand prefix for consistency. Note that some devices (e.g. TPS650)
  // do not expose the brand property.
  if (brand && model.substr(0, brand.length) === brand) {
    model = model.substr(brand.length)
  }

  // Remove manufacturer prefix for consistency
  if (model.substr(0, manufacturer.length) === manufacturer) {
    model = model.substr(manufacturer.length)
  }

  if (customMarketName) {
    marketName = customMarketName
  }
  else if (marketName) {
    var devices = androidDeviceList.getDevicesByDeviceId(marketName)
    if (devices.length > 0) {
      const deviceFilter = devices.filter(device => device.model === model)
      
      if (deviceFilter.length > 0) {
        marketName = deviceFilter[0]!.name
      }
      else {
        marketName = devices[0]!.name
      }
    }
  }

  // Clean up remaining model name
  // model = model.replace(/[_ ]/g, '')
  return {
    serial: serial
  , platform: 'Android'
  , manufacturer: manufacturer.toUpperCase()
  , operator: operator || null
  , model: model
  , version: version
  , abi: abi
  , sdk: sdk
  , product: product
  , cpuPlatform: cpuPlatform
  , openGLESVersion: openGLESVersion
  , marketName: marketName
  }
}

export default devutil
