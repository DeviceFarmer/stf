import syrup from '@devicefarmer/stf-syrup'
import deviceData from '@devicefarmer/stf-device-db'

import logger from '../../../../util/logger.js'
import type {DeviceIdentity, DevicePluginOptions} from '../../../../types/device-plugins.js'
import identitySyrup from './identity.js'

export default syrup.serial()
  .dependency(identitySyrup)
  .define(function(options: DevicePluginOptions, identity: DeviceIdentity) {
    var log = logger.createLogger('device:plugins:data')

    function find() {
      var data = deviceData.find(identity)
      if (!data) {
        log.warn('Unable to find device data', identity)
      }
      return data
    }

    return find()
  })
