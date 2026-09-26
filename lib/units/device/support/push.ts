import syrup from '@devicefarmer/stf-syrup'

import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import srv from '../../../util/srv.js'
import zmqutil from '../../../util/zmqutil.js'
import type {DeviceOptions, Push} from '../../../types/device.js'

export default syrup.serial()
  .define(function(options: DeviceOptions): Promise<Push> {
    var log = logger.createLogger('device:support:push')

    // Output
    var push = zmqutil.socket('push')

    return Promise.map(options.endpoints.push, function(endpoint) {
        return srv.resolve(endpoint).then(function(records) {
          return srv.attempt(records, function(record) {
            log.info('Sending output to "%s"', record.url)
            push.connect(record.url)
            return Promise.resolve(true)
          })
        })
      })
      .return(push)
  })
