import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {DevicePluginOptions, ZmqSocket} from '../../../types/device-plugins.js'
import pushSyrup from '../support/push.js'

export default syrup.serial()
  .dependency(pushSyrup)
  .define(function(options: DevicePluginOptions, push: ZmqSocket) {
    // Forward all logs
    logger.on('entry', function(entry) {
      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceLogMessage(
          options.serial
        , entry.timestamp / 1000
        , entry.priority
        , entry.tag
        , entry.pid
        , entry.message
        , entry.identifier
        ))
      ])
    })

    return logger
  })
