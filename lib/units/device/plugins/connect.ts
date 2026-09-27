/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import grouputil from '../../../util/grouputil.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import lifecycle from '../../../util/lifecycle.js'
import adbkeyutil from '../../../util/adbkeyutil.js'
import type {ExtendedPublicKey} from '@devicefarmer/adbkit'
type TcpUsbServer = import('@devicefarmer/adbkit/dist/src/adb/tcpusb/server.js').default
import type {EventEmitter} from 'events'
import type {ConnectStartMessageFields, OwnerMessage} from '../../../types/wire.js'
import type {
  Adb
, ConnectPlugin
, DevicePluginOptions
, GroupPlugin
, Router
, SoloPlugin
, UrlFormat
, ZmqSocket
} from '../../../types/device-plugins.js'
import adbSyrup from '../support/adb.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import groupSyrup from './group.js'
import soloSyrup from './solo.js'
import urlformatSyrup from './util/urlformat.js'

interface RemoteAdbConnection extends EventEmitter {
  remoteAddress?: string
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(groupSyrup)
  .dependency(soloSyrup)
  .dependency(urlformatSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , router: Router
  , push: ZmqSocket
  , group: GroupPlugin
  , solo: SoloPlugin
  , urlformat: UrlFormat
  ) {
    var log = logger.createLogger('device:plugins:connect')
    var plugin = Object.create(null) as ConnectPlugin
    var activeServer: TcpUsbServer | null = null
    // The owner's full adb public keys. A signature made with one of them is accepted at once, the
    // way a device accepts a key in its adb_keys, so the adb client reports "connected" instead of
    // falling back to sending its public key and reporting "failed to authenticate". The bridge
    // reads this array on every signature, so it is only ever changed in place. It holds nothing
    // but the current owner's keys, and the bridge stops when the owner leaves, so accepting a
    // signature from it is the same outcome the auth handler below would reach for that owner.
    var knownKeys: ExtendedPublicKey[] = []

    plugin.port = options.connectPort
    plugin.url = urlformat(options.connectUrlPattern, plugin.port)

    function addKnownKey(key: ExtendedPublicKey) {
      var known = knownKeys.some(function(knownKey) {
        return knownKey.fingerprint === key.fingerprint
      })
      if (!known) {
        knownKeys.push(key)
      }
    }

    // Keys only count when they come for the current owner, so a stale or foreign request can not
    // let anybody else in without going through the auth handler.
    function setKnownKeys(message: ConnectStartMessageFields | null) {
      return group.get()
        .then(function(currentGroup) {
          if (!message || message.email !== currentGroup.email) {
            return []
          }

          return Promise.map(message.adbPublicKeys || [], function(publicKey) {
            return adb.util.parsePublicKey(publicKey)
              .catch(function(err) {
                log.warn('Ignoring unparseable ADB public key', err.message)
                return null
              })
          })
        })
        .catch(grouputil.NoGroupError, function() {
          return []
        })
        .then(function(keys) {
          knownKeys.length = 0
          keys.forEach(function(key) {
            if (key) {
              addKnownKey(key)
            }
          })
        })
    }

    function encodePublicKey(key: ExtendedPublicKey) {
      try {
        return adbkeyutil.encodePublicKey(key)
      }
      catch (err) {
        log.warn('Unable to encode ADB public key "%s"', key.fingerprint, (err as Error).message)
        return null
      }
    }

    function listen() {
      return new Promise<string>(function(resolve, reject) {
        if (plugin.isRunning()) {
          resolve(plugin.url)
          return
        }

        var server = adb.createTcpUsbBridge(options.serial, {
          knownPublicKeys: knownKeys
        , auth: function(key) {
            var resolve_!: () => void, reject_!: (err: Error) => void
            var promise = new Promise<void>(function(resolve, reject) {
              resolve_ = resolve
              reject_ = reject
            })
            // Sent along so the full key can be stored for the user it belongs to
            var publicKey = encodePublicKey(key)

            function notify() {
              group.get()
                .then(function(currentGroup) {
                  push.send([
                    solo.channel
                  , wireutil.envelope(new wire.JoinGroupByAdbFingerprintMessage(
                      options.serial
                    , key.fingerprint
                    , key.comment
                    , currentGroup.group
                    , publicKey
                    ))
                  ])
                })
                .catch(grouputil.NoGroupError, function() {
                  push.send([
                    solo.channel
                  , wireutil.envelope(new wire.JoinGroupByAdbFingerprintMessage(
                      options.serial
                    , key.fingerprint
                    , key.comment
                    , null
                    , publicKey
                    ))
                  ])
                })
            }

            function joinListener(group: OwnerMessage, identifier?: string) {
              if (identifier !== key.fingerprint) {
                reject_(new Error('Somebody else took the device'))
              }
            }

            function autojoinListener(identifier: string, joined: boolean) {
              if (identifier === key.fingerprint) {
                if (joined) {
                  // Later connections in this session go through without the round trip
                  addKnownKey(key)
                  resolve_()
                }
                else {
                  reject_(new Error('Device is already in use'))
                }
              }
            }

            group.on('join', joinListener)
            group.on('autojoin', autojoinListener)
            router.on(wire.AdbKeysUpdatedMessage, notify)

            notify()

            return promise
              .timeout(120000)
              .finally(function() {
                group.removeListener('join', joinListener)
                group.removeListener('autojoin', autojoinListener)
                router.removeListener(wire.AdbKeysUpdatedMessage, notify)
              })
          }
        })

        server.on('listening', function() {
          resolve(plugin.url)
        })

        server.on('connection', function(conn: RemoteAdbConnection) {
          log.info('New remote ADB connection from %s', conn.remoteAddress)
          conn.on('userActivity', function() {
            group.keepalive()
          })
        })

        server.on('error', reject)

        log.info(util.format('Listening on port %d', plugin.port))
        server.listen(plugin.port)

        activeServer = server
        lifecycle.share('Remote ADB', activeServer!)
      })
    }

    plugin.start = function(message) {
      return setKnownKeys(message).then(function() {
        return listen()
      })
    }

    plugin.stop = Promise.method(function() {
      knownKeys.length = 0
      if (plugin.isRunning()) {
        activeServer!.close()
        activeServer!.end()
        activeServer = null
      }
    })

    plugin.end = Promise.method(function() {
      if (plugin.isRunning()) {
        activeServer!.end()
      }
    })

    plugin.isRunning = function() {
      return !!activeServer
    }

    lifecycle.observe(plugin.stop)
    group.on('leave', plugin.stop)

    router
      .on(wire.ConnectStartMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        plugin.start(message)
          .then(function(url) {
            push.send([
              channel
            , reply.okay(url)
            ])

            // Update DB
            push.send([
              channel
            , wireutil.envelope(new wire.ConnectStartedMessage(
                options.serial
              , url
              ))
            ])
            log.important('Remote Connect Started for device "%s" at "%s"', options.serial, url)
          })
          .catch(function(err) {
            log.error('Unable to start remote connect service', err.stack)
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })
      .on(wire.ConnectStopMessage, function(channel) {
        var reply = wireutil.reply(options.serial)
        plugin.stop()
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
            // Update DB
            push.send([
              channel
            , wireutil.envelope(new wire.ConnectStoppedMessage(
                options.serial
              ))
            ])
            log.important('Remote Connect Stopped for device "%s"', options.serial)
          })
          .catch(function(err) {
            log.error('Failed to stop connect service', err.stack)
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })

    return(plugin)
  })
