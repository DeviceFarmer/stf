import syrup from '@devicefarmer/stf-syrup'

import wirerouter from '../../../wire/router.js'
import type {Channels, DeviceOptions, Router, Sub} from '../../../types/device.js'
import subSyrup from './sub.js'
import channelsSyrup from './channels.js'

export default syrup.serial()
  .dependency(subSyrup)
  .dependency(channelsSyrup)
  .define(function(options: DeviceOptions, sub: Sub, channels: Channels): Router {
    var router = wirerouter()

    sub.on('message', router.handler())

    // Special case, we're hooking into a message that's not actually routed.
    router.on({$code: 'message'}, function(channel) {
      channels.keepalive(channel)
    })

    return router
  })
