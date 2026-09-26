/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'
import path from 'path'
import util from 'util'
import events from 'events'

import express from 'express'
import swaggerExpress from 'autodesk-forks-swagger-express-mw'
import swaggerUi from '@targetprocess/swagger-tools/middleware/swagger-ui.js'
import cookieSession from 'cookie-session'
import Promise from 'bluebird'
import _ from 'lodash'

import logger from '../../util/logger.js'
import zmqutil from '../../util/zmqutil.js'
import srv from '../../util/srv.js'
import lifecycle from '../../util/lifecycle.js'
import wireutil from '../../wire/util.js'
import type {ApiUnitOptions} from '../../types/units-api.js'

export default function(options: ApiUnitOptions) {
  var log = logger.createLogger('api')
  var app = express()
  var server = http.createServer(app)
  var channelRouter = new events.EventEmitter()

  var push = zmqutil.socket('push')
  Promise.map(options.endpoints.push, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Sending output to "%s"', record.url)
        push.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to push endpoint', err)
    lifecycle.fatal()
  })

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
  .catch(function(err) {
    log.fatal('Unable to connect to sub endpoint', err)
    lifecycle.fatal()
  })

  var pushdev = zmqutil.socket('push')
  Promise.map(options.endpoints.pushdev, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Sending output to "%s"', record.url)
        pushdev.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to pushdev endpoint', err)
    lifecycle.fatal()
  })

  var subdev = zmqutil.socket('sub')
  Promise.map(options.endpoints.subdev, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        subdev.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to subdev endpoint', err)
    lifecycle.fatal()
  })

  // Establish always-on channels
  ;[wireutil.global].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
    subdev.subscribe(channel)
  })

  sub.on('message', function(channel, data) {
    channelRouter.emit(channel.toString(), channel, data)
  })

  subdev.on('message', function(channel, data) {
    channelRouter.emit(channel.toString(), channel, data)
  })

  // Swagger Express Config
  var config = {
    appRoot: import.meta.dirname
  , swaggerFile: path.resolve(import.meta.dirname, 'swagger', 'api_v1.yaml')
  }

  if (typeof util.isError !== 'function') {
    Object.assign(util, {
      isError: function(value: unknown) {
        return value instanceof Error ||
          Object.prototype.toString.call(value) === '[object Error]'
      }
    })
  }

  swaggerExpress.create(config, function(err, swaggerExpress) {
    if (err) {
      throw err
    }
    app.use(swaggerUi(swaggerExpress.runner.swagger))
    swaggerExpress.register(app)
  })

  // Adding options in request, so that swagger controller
  // can use it.
  app.use(function(req, res, next) {
    var reqOptions = _.merge(options, {
      push: push
    , sub: sub
    , channelRouter: channelRouter
    , pushdev: pushdev
    , subdev: subdev
    })

    req.options = reqOptions
    next()
  })

  // TODO: Remove this once frontend is stateless
  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))

  app.disable('x-powered-by')

  lifecycle.observe(function() {
    [push, sub, pushdev, subdev].forEach(function(sock) {
      try {
        sock.close()
      }
      catch (err) {
        // No-op
      }
    })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
