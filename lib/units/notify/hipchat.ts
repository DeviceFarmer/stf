/* eslint quote-props:0 */

import util from 'util'

import Hipchatter from 'hipchatter'
import Promise from 'bluebird'

import logger from '../../util/logger.js'
import wire from '../../wire/index.js'
import wirerouter from '../../wire/router.js'
import wireutil from '../../wire/util.js'
import lifecycle from '../../util/lifecycle.js'
import srv from '../../util/srv.js'
import zmqutil from '../../util/zmqutil.js'
import type {DeviceLogMessageFields} from '../../types/wire.js'

interface NotifyHipchatOptions {
  token: string
  room: string
  priority: number
  notifyPriority: number
  endpoints: {
    sub: string[]
  }
}

var COLORS: Record<number, string> = {
  1: 'gray'
, 2: 'gray'
, 3: 'green'
, 4: 'purple'
, 5: 'yellow'
, 6: 'red'
, 7: 'red'
}

export default function(options: NotifyHipchatOptions) {
  var log = logger.createLogger('notify-hipchat')
  var client = Promise.promisifyAll(new Hipchatter(options.token))
  var buffer: DeviceLogMessageFields[] = []
  var timer: ReturnType<typeof setTimeout> | undefined

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

  function push() {
    buffer.splice(0).forEach(function(entry) {
      client.notifyAsync(options.room, {
        message: util.format(
          '<strong>%s</strong>/<strong>%s</strong> %d [<strong>%s</strong>] %s'
          , logger.LevelLabel[entry.priority]
          , entry.tag
          , entry.pid
          , entry.identifier
          , entry.message
        )
        , color: COLORS[entry.priority]
        , notify: entry.priority >= options.notifyPriority
        , message_format: 'html'
        , token: options.token
      })
    })
  }

  sub.on('message', wirerouter()
    .on(wire.DeviceLogMessage, function(channel, message) {
      if (message.priority >= options.priority) {
        buffer.push(message)
        clearTimeout(timer)
        timer = setTimeout(push, 1000)
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
