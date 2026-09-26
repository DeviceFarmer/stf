import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import type {Abi, DeviceOptions, Properties, Sdk} from '../../../types/device.js'
import propertiesSyrup from './properties.js'
import sdkSyrup from './sdk.js'

export default syrup.serial()
  .dependency(propertiesSyrup)
  .dependency(sdkSyrup)
  .define(function(options: DeviceOptions, properties: Properties, sdk: Sdk): Abi {
    var log = logger.createLogger('device:support:abi')
    return (function() {
      function split(list: string | undefined) {
        return list ? list.split(',') : []
      }

      var abi: Abi = {
        primary: properties['ro.product.cpu.abi']!
      , pie: sdk.level >= 16
      , all: [] as string[]
      , b32: [] as string[]
      , b64: [] as string[]
      }

      // Since Android 5.0
      if (properties['ro.product.cpu.abilist']) {
        abi.all = split(properties['ro.product.cpu.abilist'])
        abi.b64 = split(properties['ro.product.cpu.abilist64'])
        abi.b32 = split(properties['ro.product.cpu.abilist32'])
      }
      // Up to Android 4.4
      else {
        abi.all.push(abi.primary)
        abi.b32.push(abi.primary)
        if (properties['ro.product.cpu.abi2']) {
          abi.all.push(properties['ro.product.cpu.abi2'])
          abi.b32.push(properties['ro.product.cpu.abi2'])
        }
      }

      log.info('Supports ABIs %s', abi.all.join(', '))

      return abi
    })()
  })
