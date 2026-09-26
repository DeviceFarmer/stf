/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../../util/logger.js'
import wire from '../../../../wire/index.js'
import wireutil from '../../../../wire/util.js'
import type {Duplex, Readable} from 'stream'
import type Bluebird from 'bluebird'
import adbSyrup from '../../support/adb.js'
import routerSyrup from '../../support/router.js'
import pushSyrup from '../../support/push.js'
import storageSyrup from '../../support/storage.js'
import minicapSyrup from '../../resources/minicap.js'
import displaySyrup from '../util/display.js'

type Adb = ReturnType<typeof import('../../../../util/adbutil.js').default>
type Router = ReturnType<typeof import('../../../../wire/router.js').default>
type Push = ReturnType<typeof import('../../../../util/zmqutil.js').default['socket']>

interface CaptureOptions {
  serial: string
}

interface StorageMeta {
  filename: string
  contentType: string
  knownLength: number
}

interface Storage {
  store(type: string, stream: Readable, meta: StorageMeta): Bluebird<unknown>
}

interface Minicap {
  run(mode: string, cmd: string): Bluebird<Duplex>
}

interface Display {
  properties: {
    width: number
    height: number
    rotation: number
  }
}

interface CapturePlugin {
  capture(): Bluebird<unknown>
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(storageSyrup)
  .dependency(minicapSyrup)
  .dependency(displaySyrup)
  .define(function(
    options: CaptureOptions
  , adb: Adb
  , router: Router
  , push: Push
  , storage: Storage
  , minicap: Minicap
  , display: Display
  ) {
    var log = logger.createLogger('device:plugins:screen:capture')
    var plugin: CapturePlugin = Object.create(null)

    function projectionFormat() {
      return util.format(
        '%dx%d@%dx%d/%d'
      , display.properties.width
      , display.properties.height
      , display.properties.width
      , display.properties.height
      , display.properties.rotation
      )
    }

    plugin.capture = function() {
      log.info('Capturing screenshot')

      var file = util.format('/data/local/tmp/minicap_%d.jpg', Date.now())
      return minicap.run('minicap-apk', util.format(
          '-P %s -s >%s', projectionFormat(), file))
        .then(adb.util.readAll)
        .then(function() {
          return adb.stat(options.serial, file)
        })
        .then(function(stats) {
          if (stats.size === 0) {
            throw new Error('Empty screenshot; possibly secure screen?')
          }

          return adb.pull(options.serial, file)
            .then(function(transfer) {
              return storage.store('image', transfer, {
                filename: util.format('%s.jpg', options.serial)
              , contentType: 'image/jpeg'
              , knownLength: stats.size
              })
            })
        })
        .finally(function() {
          return adb.shell(options.serial, ['rm', '-f', file])
            .then(adb.util.readAll)
        })
    }

    router.on(wire.ScreenCaptureMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      plugin.capture()
        .then(function(file) {
          push.send([
            channel
          , reply.okay('success', file)
          ])
        })
        .catch(function(err) {
          log.error('Screen capture failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })

    return plugin
  })
