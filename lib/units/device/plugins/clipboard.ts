import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {
  DevicePluginOptions
, Router
, ServicePlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import serviceSyrup from './service.js'

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(serviceSyrup)
  .define(function(
    options: DevicePluginOptions
  , router: Router
  , push: ZmqSocket
  , service: ServicePlugin
  ) {
    var log = logger.createLogger('device:plugins:clipboard')

    router.on(wire.PasteMessage, function(channel, message) {
      log.info('Pasting "%s" to clipboard', message.text)
      var reply = wireutil.reply(options.serial)
      service.paste(message.text)
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Paste failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })

    router.on(wire.CopyMessage, function(channel) {
      log.info('Copying clipboard contents')
      var reply = wireutil.reply(options.serial)
      service.copy()
        .then(function(content) {
          push.send([
            channel
          , reply.okay(content)
          ])
        })
        .catch(function(err) {
          log.error('Copy failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
