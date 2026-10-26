import syrup from '@devicefarmer/stf-syrup'

import devutil from '../../../../util/devutil.js'
import logger from '../../../../util/logger.js'
import type {Properties} from '@devicefarmer/adbkit'
import type {
  DeviceDisplay
, DeviceIdentity
, DevicePluginOptions
, PhoneProperties
} from '../../../../types/device-plugins.js'
import propertiesSyrup from '../../support/properties.js'
import displaySyrup from './display.js'
import phoneSyrup from './phone.js'

export default syrup.serial()
  .dependency(propertiesSyrup)
  .dependency(displaySyrup)
  .dependency(phoneSyrup)
  .define(function(
    options: DevicePluginOptions
  , properties: Properties
  , display: DeviceDisplay
  , phone: PhoneProperties
  ) {
    var log = logger.createLogger('device:plugins:identity')

    function solve() {
      log.info('Solving identity')
      var identity = devutil.makeIdentity(options.serial, properties) as DeviceIdentity
      identity.display = display.properties
      identity.phone = phone
      return identity
    }

    return solve()
  })
