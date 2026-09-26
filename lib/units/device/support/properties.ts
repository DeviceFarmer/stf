import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import type Bluebird from 'bluebird'
import type {Adb, DeviceOptions, Properties} from '../../../types/device.js'
import adbSyrup from './adb.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .define(function(options: DeviceOptions, adb: Adb): Bluebird<Properties> {
    var log = logger.createLogger('device:support:properties')

    function load() {
      log.info('Loading properties')
      return adb.getProperties(options.serial)
        .timeout(10000)
    }

    return load()
  })
