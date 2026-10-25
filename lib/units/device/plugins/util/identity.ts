import syrup from '@devicefarmer/stf-syrup'

import devutil from '../../../../util/devutil.js'
import logger from '../../../../util/logger.js'
import type {Properties} from '@devicefarmer/adbkit'
import type {
  DeviceDisplay
, DeviceIdentity
, DevicePluginOptions
, HwProbeResult
, PhoneProperties
} from '../../../../types/device-plugins.js'
import propertiesSyrup from '../../support/properties.js'
import displaySyrup from './display.js'
import phoneSyrup from './phone.js'
import hwprobeSyrup from './hwprobe.js'

export default syrup.serial()
  .dependency(propertiesSyrup)
  .dependency(displaySyrup)
  .dependency(phoneSyrup)
  .dependency(hwprobeSyrup)
  .define(function(
    options: DevicePluginOptions
  , properties: Properties
  , display: DeviceDisplay
  , phone: PhoneProperties
  , hwprobe?: HwProbeResult
  ) {
    var log = logger.createLogger('device:plugins:identity')

    function solve() {
      log.info('Solving identity')
      var identity = devutil.makeIdentity(options.serial, properties) as DeviceIdentity
      identity.display = display.properties
      identity.phone = phone
      var customMarketName = properties['debug.stf.product.device']
      if ((!customMarketName || !customMarketName.trim()) &&
          hwprobe && hwprobe.marketName) {
        identity.marketName = hwprobe.marketName
      }
      return identity
    }

    return solve()
  })
