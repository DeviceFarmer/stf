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
    var log = logger.createLogger('device:plugins:ringer')

    router.on(wire.RingerSetMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)

      log.info('Setting ringer mode to mode "%s"', message.mode)

      service.setRingerMode(message.mode)
        .timeout(30000)
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Setting ringer mode failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })

    router.on(wire.RingerGetMessage, function(channel) {
      var reply = wireutil.reply(options.serial)

      log.info('Getting ringer mode')

      service.getRingerMode()
        .timeout(30000)
        .then(function(mode) {
          push.send([
            channel
          , reply.okay('success', mode)
          ])
        })
        .catch(function(err) {
          log.error('Getting ringer mode failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
