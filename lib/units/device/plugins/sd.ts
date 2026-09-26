import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {
  DevicePluginOptions
, Router
, ServicePlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import serviceSyrup from './service.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'

export default syrup.serial()
  .dependency(serviceSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(
    options: DevicePluginOptions
  , service: ServicePlugin
  , router: Router
  , push: ZmqSocket
  ) {
    var log = logger.createLogger('device:plugins:sd')

    router.on(wire.SdStatusMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      log.info('Getting SD card status')
      service.getSdStatus(message)
        .timeout(30000)
        .then(function(mounted) {
          push.send([
            channel
          , reply.okay(mounted ? 'sd_mounted' : 'sd_unmounted')
          ])
        })
        .catch(function(err) {
          log.error('Getting SD card Status', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
