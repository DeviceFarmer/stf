import syrup from '@devicefarmer/stf-syrup'

import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wireutil from '../../../wire/util.js'
import srv from '../../../util/srv.js'
import '../../../util/lifecycle.js'
import zmqutil from '../../../util/zmqutil.js'
import type {DeviceOptions, Sub} from '../../../types/device.js'

export default syrup.serial()
  .define(function(options: DeviceOptions): Promise<Sub> {
    var log = logger.createLogger('device:support:sub')

    // Input
    var sub = zmqutil.socket('sub')

    return Promise.map(options.endpoints.sub, function(endpoint) {
        return srv.resolve(endpoint).then(function(records) {
          return srv.attempt(records, function(record) {
            log.info('Receiving input from "%s"', record.url)
            sub.connect(record.url)
            return Promise.resolve(true)
          })
        })
      })
      .then(function() {
        // Establish always-on channels
        [wireutil.global].forEach(function(channel) {
          log.info('Subscribing to permanent channel "%s"', channel)
          sub.subscribe(channel)
        })
      })
      .return(sub)
  })
