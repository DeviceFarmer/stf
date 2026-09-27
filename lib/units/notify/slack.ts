/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import {WebClient} from '@slack/web-api'
import Promise from 'bluebird'

import logger from '../../util/logger.js'
import wire from '../../wire/index.js'
import wirerouter from '../../wire/router.js'
import wireutil from '../../wire/util.js'
import lifecycle from '../../util/lifecycle.js'
import srv from '../../util/srv.js'
import zmqutil from '../../util/zmqutil.js'
import type {DeviceLogMessageFields} from '../../types/wire.js'

interface NotifySlackOptions {
  token: string
  channel: string
  priority: number
  endpoints: {
    sub: string[]
  }
}

export default function(options: NotifySlackOptions) {
  var log = logger.createLogger('notify-slack')
  var client = new WebClient(options.token)
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
      var format = entry.message.indexOf('\n') === -1 ? '`%s`' : '```%s```'
      var message = util.format(format, entry.message)

      client.chat.postMessage({
        channel: options.channel
      , text: util.format(
        '>>> *%s/%s* %d [*%s*] %s'
        , logger.LevelLabel[entry.priority]
        , entry.tag
        , entry.pid
        , entry.identifier
        , message
        )
      , username: 'STF'
      , icon_url: 'https://openstf.io/favicon.png'
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
