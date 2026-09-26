//
// Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import stream from 'stream'
import url from 'url'
import util from 'util'

import syrup from '@devicefarmer/stf-syrup'
import request from '@cypress/request'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import promiseutil from '../../../util/promiseutil.js'
type PushTransfer = import('@devicefarmer/adbkit/dist/src/adb/sync/pushtransfer.js').default
import type {Adb, DevicePluginOptions, Router, ZmqSocket} from '../../../types/device-plugins.js'
import adbSyrup from '../support/adb.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'

interface InstallError extends Error {
  code?: string
}

interface ApkManifest {
  package: string
  application: {
    launcherActivities: Array<{name: string}>
  }
}

// The error codes are available at https://github.com/android/
// platform_frameworks_base/blob/master/core/java/android/content/
// pm/PackageManager.java
function InstallationError(err: InstallError) {
  return err.code && /^INSTALL_/.test(err.code)
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , router: Router
  , push: ZmqSocket
  ) {
    var log = logger.createLogger('device:plugins:install')

    router.on(wire.InstallMessage, function(channel, message) {
      var manifest: ApkManifest = JSON.parse(message.manifest!)
      var pkg = manifest.package

      log.info('Installing package "%s" from "%s"', pkg, message.href)

      var reply = wireutil.reply(options.serial)

      function sendProgress(data: string, progress: number) {
        push.send([
          channel
        , reply.progress(data, progress)
        ])
      }

      function pushApp() {
        var req = request({
          url: url.resolve(options.storageUrl, message.href)
        })

        // We need to catch the Content-Length on the fly or we risk
        // losing some of the initial chunks.
        var contentLength: number | null = null
        req.on('response', function(res) {
          contentLength = parseInt(res.headers['content-length'] as string, 10)
        })

        var source = new stream.Readable().wrap(req as unknown as NodeJS.ReadableStream)
        var target = '/data/local/tmp/_app.apk'

        return adb.push(options.serial, source, target)
          .timeout(10000)
          .then(function(transfer) {
            var resolve_!: (value: string) => void, reject_!: (err: Error) => void
            var promise = new Promise<string>(function(resolve, reject) {
              resolve_ = resolve
              reject_ = reject
            })

            function endListener() {
              resolve_(target)
            }

            function progressListener(stats: PushTransfer['stats']) {
              if (contentLength) {
                // Progress 0% to 70%
                sendProgress(
                  'pushing_app'
                , 50 * Math.max(0, Math.min(
                    50
                  , stats.bytesTransferred / contentLength
                  ))
                )
                // temporary workaround as the 'end' event is never fired
                if ((stats.bytesTransferred / contentLength) === 1 &&
                     (process.versions.node.split('.')[0] as unknown as number) >= 16) {
                  endListener()
                }
              }
            }

            function errorListener(err: Error) {
              reject_(err)
            }

            transfer.on('progress', progressListener)
            transfer.on('error', errorListener)
            transfer.on('end', endListener)

            return promise.finally(function() {
              transfer.removeListener('progress', progressListener)
              transfer.removeListener('error', errorListener)
              transfer.removeListener('end', endListener)
            })
          })
      }

      // Progress 0%
      sendProgress('pushing_app', 0)
      pushApp()
        .then(function(apk) {
          var start = 50
          var end = 90
          var guesstimate = start

          sendProgress('installing_app', guesstimate)
          return promiseutil.periodicNotify(
              adb.installRemote(options.serial, apk)
                .timeout(60000 * 5)
                .catch(function(err) {
                  switch (err.code) {
                  case 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES':
                  case 'INSTALL_FAILED_VERSION_DOWNGRADE':
                    log.info(
                      'Uninstalling "%s" first due to inconsistent certificates'
                    , pkg
                    )
                    return adb.uninstall(options.serial, pkg)
                      .timeout(15000)
                      .then(function() {
                        return adb.installRemote(options.serial, apk)
                          .timeout(60000 * 5)
                      })
                  default:
                    return Promise.reject(err)
                  }
                })
            , 250
            , function() {
                guesstimate = Math.min(
                  end
                , guesstimate + 1.5 * (end - guesstimate) / (end - start)
                )
                sendProgress('installing_app', guesstimate)
              }
            )
        })
        .then<boolean | void>(function() {
          if (message.launch) {
            if (manifest.application.launcherActivities.length) {
              var activityName = manifest.application.launcherActivities[0]!.name

              // According to the AndroidManifest.xml documentation the dot is
              // required, but actually it isn't.
              if (activityName.indexOf('.') === -1) {
                activityName = util.format('.%s', activityName)
              }

              var launchActivity = {
                action: 'android.intent.action.MAIN'
              , component: util.format(
                  '%s/%s'
                , pkg
                , activityName
                )
              , category: ['android.intent.category.LAUNCHER']
              , flags: 0x10200000
              }

              log.info(
                'Launching activity with action "%s" on component "%s"'
              , launchActivity.action
              , launchActivity.component
              )
              // Progress 90%
              sendProgress('launching_app', 90)
              return adb.startActivity(options.serial, launchActivity)
                .timeout(30000)
            }
          }
          return Promise.resolve()
        })
        .then(function() {
          push.send([
            channel
          , reply.okay('INSTALL_SUCCEEDED')
          ])
        })
        .catch(Promise.TimeoutError, function(err) {
          log.error('Installation of package "%s" failed', pkg, err.stack)
          push.send([
            channel
          , reply.fail('INSTALL_ERROR_TIMEOUT')
          ])
        })
        .catch(InstallationError as (err: InstallError) => boolean, function(err) {
          log.important(
            'Tried to install package "%s", got "%s"'
          , pkg
          , err.code
          )
          push.send([
            channel
          , reply.fail(err.code)
          ])
        })
        .catch(function(err) {
          log.error('Installation of package "%s" failed', pkg, err.stack)
          push.send([
            channel
          , reply.fail('INSTALL_ERROR_UNKNOWN')
          ])
        })
    })

    router.on(wire.UninstallMessage, function(channel, message) {
      log.info('Uninstalling "%s"', message.packageName)

      var reply = wireutil.reply(options.serial)

      adb.uninstall(options.serial, message.packageName)
        .then(function() {
          push.send([
            channel
          , reply.okay('success')
          ])
        })
        .catch(function(err) {
          log.error('Uninstallation failed', err.stack)
          push.send([
            channel
          , reply.fail('fail')
          ])
        })
    })
  })
