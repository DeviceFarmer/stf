import util from 'util'
import path from 'path'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import pathutil from '../../../util/pathutil.js'
import devutil from '../../../util/devutil.js'
import streamutil from '../../../util/streamutil.js'
import Resource from './util/resource.js'
import type {Abi, Adb, DeviceOptions, Minicap, Properties, Sdk} from '../../../types/device.js'
import adbSyrup from '../support/adb.js'
import propertiesSyrup from '../support/properties.js'
import abiSyrup from '../support/abi.js'
import sdkSyrup from '../support/sdk.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(propertiesSyrup)
  .dependency(abiSyrup)
  .dependency(sdkSyrup)
  .define(function(
    options: DeviceOptions
  , adb: Adb
  , properties: Properties
  , abi: Abi
  , sdk: Sdk
  ): Promise<Minicap> {
    var log = logger.createLogger('device:resources:minicap')

    var resources = {
      bin: new Resource({
        src: pathutil.requiredMatch(abi.all.map(function(supportedAbi: string) {
          return pathutil.module(util.format(
            '@devicefarmer/minicap-prebuilt/prebuilt/%s/bin/minicap%s'
          , supportedAbi
          , abi.pie ? '' : '-nopie'
          ))
        }))
      , dest: [
          '/data/local/tmp/minicap'
        , '/data/data/com.android.shell/minicap'
        ]
      , comm: 'minicap'
      , mode: 0o755
      })
    , lib: new Resource({
        // @todo The lib ABI should match the bin ABI. Currently we don't
        // have an x86_64 version of the binary while the lib supports it.
        src: pathutil.match(abi.all.reduce(function(all: string[], supportedAbi: string) {
          return all.concat([
            pathutil.module(util.format(
              '@devicefarmer/minicap-prebuilt/prebuilt/%s/lib/android-%s/minicap.so'
            , supportedAbi
            , sdk.previewLevel
            ))
          , pathutil.module(util.format(
              '@devicefarmer/minicap-prebuilt/prebuilt/%s/lib/android-%s/minicap.so'
            , supportedAbi
            , sdk.level
            ))
          ])
        }, []))
      , dest: [
          '/data/local/tmp/minicap.so'
        , '/data/data/com.android.shell/minicap.so'
        ]
      , comm: 'minicap.so' // Not actually used for anything but log output
      , mode: 0o755
      })
    , apk: new Resource({
        src: pathutil.match([pathutil.module(
          '@devicefarmer/minicap-prebuilt/prebuilt/noarch/minicap.apk')])
      , dest: ['/data/local/tmp/minicap.apk']
      , comm: 'minicap.apk'
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
      var resourcesToBeinstalled: Promise<unknown>[] = []
      if(resources.lib.src) {
        resourcesToBeinstalled.push(installResource(resources.bin))
        resourcesToBeinstalled.push(installResource(resources.lib))
      }
      if(resources.apk.src) {
        resourcesToBeinstalled.push(installResource(resources.apk))
      }
      return Promise.all(resourcesToBeinstalled)
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
        , lib: resources.lib.dest
        , apk: resources.apk.dest
        , run: function(mode: string, cmd: string) {
            var runCmd
            if(mode === 'minicap-bin' && resources.lib.src) {
              runCmd = util.format(
                'LD_LIBRARY_PATH=%s exec %s %s'
              , path.dirname(resources.lib.dest)
              , resources.bin.dest
              , cmd
              )
            }
            else if(mode === 'minicap-apk' && resources.apk.src) {
              runCmd = util.format(
                'CLASSPATH=%s app_process /system/bin io.devicefarmer.minicap.Main %s'
              , resources.apk.dest
              , cmd
              )
            }
            else {
              log.error('Missing resources/unknown minicap grabber: %s', mode)
            }
            log.info(runCmd)
            return adb.shell(options.serial, runCmd as string)
          }
        }
      })
  })
