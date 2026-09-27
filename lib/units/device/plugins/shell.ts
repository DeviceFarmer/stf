import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {ShellKeepAliveMessage} from '../../../types/wire.js'
import type {Adb, DevicePluginOptions, Router, ZmqSocket} from '../../../types/device-plugins.js'
import adbSyrup from '../support/adb.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import subSyrup from '../support/sub.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , router: Router
  , push: ZmqSocket
  , sub: ZmqSocket
  ) {
    var log = logger.createLogger('device:plugins:shell')

    router.on(wire.ShellCommandMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)

      log.info('Running shell command "%s"', message.command)

      adb.shell(options.serial, message.command)
        .timeout(10000)
        .then(function(stream) {
          var resolve_!: () => void
            , reject_!: (err: Error) => void
            , timer: ReturnType<typeof setTimeout> | undefined
          var promise = new Promise<void>(function(resolve, reject) {
            resolve_ = resolve
            reject_ = reject
          })

          function forceStop() {
            stream.end()
          }

          function keepAliveListener(channel: string | Buffer, message: ShellKeepAliveMessage) {
            clearTimeout(timer)
            timer = setTimeout(forceStop, message.timeout)
          }

          function readableListener() {
            var chunk
            while ((chunk = stream.read())) {
              push.send([
                channel
              , reply.progress(chunk)
              ])
            }
          }

          function endListener() {
            push.send([
              channel
            , reply.okay(null)
            ])
            resolve_()
          }

          function errorListener(err: Error) {
            reject_(err)
          }

          stream.setEncoding('utf8')

          stream.on('readable', readableListener)
          stream.on('end', endListener)
          stream.on('error', errorListener)

          sub.subscribe(channel as string)
          router.on(wire.ShellKeepAliveMessage, keepAliveListener)

          timer = setTimeout(forceStop, message.timeout)

          return promise.finally(function() {
            stream.removeListener('readable', readableListener)
            stream.removeListener('end', endListener)
            stream.removeListener('error', errorListener)
            sub.unsubscribe(channel as string)
            router.removeListener(wire.ShellKeepAliveMessage, keepAliveListener)
            clearTimeout(timer)
          })
        })
        .error(function(err) {
          log.error('Shell command "%s" failed', message.command, err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
