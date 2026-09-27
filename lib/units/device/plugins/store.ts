import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {Adb, DevicePluginOptions, Router, ZmqSocket} from '../../../types/device-plugins.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import adbSyrup from '../support/adb.js'

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(adbSyrup)
  .define(function(
    options: DevicePluginOptions
  , router: Router
  , push: ZmqSocket
  , adb: Adb
  ) {
    var log = logger.createLogger('device:plugins:store')

    router.on(wire.StoreOpenMessage, function(channel) {
      log.info('Opening Play Store')

      var reply = wireutil.reply(options.serial)
      adb.startActivity(options.serial, {
          action: 'android.intent.action.MAIN'
        , component: 'com.android.vending/.AssetBrowserActivity'
          // FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
          // FLAG_ACTIVITY_BROUGHT_TO_FRONT
          // FLAG_ACTIVITY_NEW_TASK
        , flags: 0x10600000
        })
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Play Store could not be opened', err.stack)
          push.send([
            channel
          , reply.fail()
          ])
        })
    })
  })
