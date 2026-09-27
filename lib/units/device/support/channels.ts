import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import ChannelManager from '../../../wire/channelmanager.js'

export default syrup.serial()
  .define(function() {
    var log = logger.createLogger('device:support:channels')
    var channels = new ChannelManager()
    channels.on('timeout', function(channel) {
      log.info('Channel "%s" timed out', channel)
    })
    return channels
  })
