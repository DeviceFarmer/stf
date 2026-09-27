import util from 'util'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import pathutil from '../../../util/pathutil.js'
import devutil from '../../../util/devutil.js'
import streamutil from '../../../util/streamutil.js'
import Resource from './util/resource.js'
import type {Abi, Adb, DeviceOptions, Minitouch} from '../../../types/device.js'
import adbSyrup from '../support/adb.js'
import abiSyrup from '../support/abi.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(abiSyrup)
  .define(function(options: DeviceOptions, adb: Adb, abi: Abi): Promise<Minitouch> {
    var log = logger.createLogger('device:resources:minitouch')

    var resources = {
      bin: new Resource({
        src: pathutil.requiredMatch(abi.all.map(function(supportedAbi: string) {
          return pathutil.module(util.format(
            '@devicefarmer/minitouch-prebuilt/prebuilt/%s/bin/minitouch%s'
          , supportedAbi
          , abi.pie ? '' : '-nopie'
          ))
        }))
      , dest: [
          '/data/local/tmp/minitouch'
        , '/data/data/com.android.shell/minitouch'
        ]
      , comm: 'minitouch'
      , mode: 0o755
      })
    }

    function removeResource(res: Resource) {
      return adb.shell(options.serial, ['rm', '-f', res.dest])
        .timeout(10000)
        .then(function(out) {
          return streamutil.readAll(out)
        })
        .return(res)
    }

    function pushResource(res: Resource) {
      return adb.push(options.serial, res.src as string, res.dest, res.mode)
        .timeout(10000)
        .then(function(transfer) {
          return new Promise(function(resolve, reject) {
            transfer.on('error', reject)
            transfer.on('end', resolve)
          })
        })
        .return(res)
    }

    function installResource(res: Resource): Promise<Resource> {
      log.info('Installing "%s" as "%s"', res.src, res.dest)

      function checkExecutable(res: Resource) {
        return adb.stat(options.serial, res.dest)
          .timeout(5000)
          .then(function(stats) {
            // Can't use fs.constants.S_IXUSR due to differences on Windows.
            return (stats.mode & 0x40) === 0x40
          })
      }

      return removeResource(res)
        .then(pushResource)
        .then(function(res) {
          return checkExecutable(res).then(function(ok) {
            if (!ok) {
              log.info(
                'Pushed "%s" not executable, attempting fallback location'
              , res.comm
              )
              res.shift()
              return installResource(res)
            }
            return res
          })
        })
        .return(res)
    }

    function installAll() {
      return Promise.all([
        installResource(resources.bin)
      ])
    }

    function stop() {
      return devutil.killProcsByComm(
          adb
        , options.serial
        , resources.bin.comm
        , resources.bin.dest
        )
        .timeout(15000)
    }

    return stop()
      .then(installAll)
      .then(function() {
        return {
          bin: resources.bin.dest
        , run: function(cmd?: string) {
            return adb.shell(options.serial, util.format(
              'exec %s%s'
            , resources.bin.dest
            , cmd ? util.format(' %s', cmd) : ''
            ))
          }
        }
      })
  })
