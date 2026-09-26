import Promise from 'bluebird'

import logger from '../../util/logger.js'
import wire from '../../wire/index.js'
import wirerouter from '../../wire/router.js'
import wireutil from '../../wire/util.js'
import lifecycle from '../../util/lifecycle.js'
import srv from '../../util/srv.js'
import dbapi from '../../db/api.js'
import zmqutil from '../../util/zmqutil.js'

interface LogRethinkdbOptions {
  priority: number
  endpoints: {
    sub: string[]
  }
}

export default function(options: LogRethinkdbOptions) {
  var log = logger.createLogger('log-db')

  // Input
  var sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })

  // Establish always-on channels
  ;[wireutil.global].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  sub.on('message', wirerouter()
    .on(wire.DeviceLogMessage, function(channel, message) {
      if (message.priority >= options.priority) {
        dbapi.saveDeviceLog(message.serial, message)
      }
    })
    .handler())

  log.info('Listening for %s (or higher) level log messages',
    logger.LevelLabel[options.priority])

  lifecycle.observe(function() {
    try {
      sub.close()
    }
    catch (err) {
      // No-op
    }
  })
}
