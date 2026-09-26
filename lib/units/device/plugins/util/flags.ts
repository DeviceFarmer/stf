import syrup from '@devicefarmer/stf-syrup'
import type {DeviceData, DevicePluginOptions, Flags} from '../../../../types/device-plugins.js'
import dataSyrup from './data.js'

export default syrup.serial()
  .dependency(dataSyrup)
  .define(function(options: DevicePluginOptions, data: DeviceData | null): Flags {
    return {
      has: function(flag) {
        return data && data.flags && !!data.flags[flag]
      }
    , get: function(flag, defaultValue) {
        return data && data.flags && typeof data.flags[flag] !== 'undefined' ?
          data.flags[flag] :
          defaultValue
      }
    }
  })
