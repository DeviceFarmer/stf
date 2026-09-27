/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import syrup from '@devicefarmer/stf-syrup'
import logger from '../../../util/logger.js'
import promiseutil from '../../../util/promiseutil.js'
import type Bluebird from 'bluebird'
import type {Adb, DeviceOptions} from '../../../types/device.js'

var require = createRequire(import.meta.url)

export default syrup.serial()
  .define(function(options: DeviceOptions): Bluebird<Adb> {
    var log = logger.createLogger('device:support:adb')
    var adb: Adb = require('../../../util/adbutil.js').default(options)

    function ensureBootComplete() {
      return promiseutil.periodicNotify(
          adb.waitBootComplete(options.serial)
        , 1000
        , function() {
            log.info('Waiting for boot to complete')
          }
        )
        .timeout(options.bootCompleteTimeout)
    }

    return ensureBootComplete()
      .return(adb)
  })
