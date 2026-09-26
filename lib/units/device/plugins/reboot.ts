import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {Adb, DevicePluginOptions, Router, ZmqSocket} from '../../../types/device-plugins.js'
import adbSyrup from '../support/adb.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , router: Router
  , push: ZmqSocket
  ) {
    var log = logger.createLogger('device:plugins:reboot')

    router.on(wire.RebootMessage, function(channel) {
      var reply = wireutil.reply(options.serial)

      log.important('Rebooting')

      adb.reboot(options.serial)
        .timeout(30000)
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .error(function(err) {
          log.error('Reboot failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
