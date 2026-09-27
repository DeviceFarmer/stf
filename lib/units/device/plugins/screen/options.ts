import syrup from '@devicefarmer/stf-syrup'
import _ from 'lodash'

interface ScreenOptionsUnitOptions {
  serial: string
  publicIp: string
  screenPort: number
  screenWsUrlPattern: string
}

interface ScreenOptions {
  devicePort: number
  publicPort: number
  publicUrl: string
}

export default syrup.serial()
  .define(function(options: ScreenOptionsUnitOptions) {
    var plugin: ScreenOptions = Object.create(null)

    plugin.devicePort = 9002
    plugin.publicPort = options.screenPort
    plugin.publicUrl = _.template(options.screenWsUrlPattern)({
      publicIp: options.publicIp
    , publicPort: plugin.publicPort
    , serial: options.serial
    })

    return plugin
  })
