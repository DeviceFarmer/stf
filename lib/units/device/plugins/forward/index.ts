import net from 'net'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import _ from 'lodash'

import wire from '../../../../wire/index.js'
import logger from '../../../../util/logger.js'
import lifecycle from '../../../../util/lifecycle.js'
import streamutil from '../../../../util/streamutil.js'
import wireutil from '../../../../wire/util.js'

import ForwardManager from './util/manager.js'
import type {EventEmitter} from 'events'
import type {Duplex} from 'stream'
import type {
  ForwardCreateMessageFields
, ForwardTestMessageFields
, ReverseForward
} from '../../../../types/wire.js'
import adbSyrup from '../../support/adb.js'
import routerSyrup from '../../support/router.js'
import pushSyrup from '../../support/push.js'
import minirevSyrup from '../../resources/minirev.js'
import groupSyrup from '../group.js'

type Adb = ReturnType<typeof import('../../../../util/adbutil.js').default>
type Router = ReturnType<typeof import('../../../../wire/router.js').default>
type Push = ReturnType<typeof import('../../../../util/zmqutil.js').default['socket']>

interface ForwardPluginOptions {
  serial: string
}

interface Minirev {
  bin: string
}

interface ForwardPlugin {
  createForward(id: string, forward: ForwardCreateMessageFields): Promise<void>
  removeForward(id: string): Promise<void>
  connect(options: ForwardTestMessageFields): Promise<net.Socket>
  reset(): void
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(minirevSyrup)
  .dependency(groupSyrup)
  .define(function(
    options: ForwardPluginOptions
  , adb: Adb
  , router: Router
  , push: Push
  , minirev: Minirev
  , group: EventEmitter
  ) {
    var log = logger.createLogger('device:plugins:forward')
    var plugin: ForwardPlugin = Object.create(null)
    var manager = new ForwardManager()

    function startService() {
      log.info('Launching reverse port forwarding service')
      return adb.shell(options.serial, [
          'exec'
        , minirev.bin
        ])
        .timeout(10000)
        .then(function(out) {
          lifecycle.share('Forward shell', out)
          streamutil.talk(log, 'Forward shell says: "%s"', out)
        })
    }

    function connectService(times: number) {
      function tryConnect(times: number, delay: number): Promise<Duplex> {
        return adb.openLocal(options.serial, 'localabstract:minirev')
          .timeout(10000)
          .catch(function(err) {
            if (/closed/.test(err.message) && times > 1) {
              return Promise.delay(delay)
                .then(function() {
                  return tryConnect(times - 1, delay * 2)
                })
            }
            return Promise.reject(err)
          })
      }
      log.info('Connecting to reverse port forwarding service')
      return tryConnect(times, 100)
    }

    function awaitServer() {
      return connectService(5)
        .then(function(conn) {
          conn.end()
          return true
        })
    }

    plugin.createForward = function(id, forward) {
      log.info(
        'Creating reverse port forward "%s" from ":%d" to "%s:%d"'
      , id
      , forward.devicePort
      , forward.targetHost
      , forward.targetPort
      )
      return connectService(1)
        .then(function(out) {
          var header = Buffer.alloc(4)
          header.writeUInt16LE(0, 0)
          header.writeUInt16LE(forward.devicePort, 2)
          out.write(header)
          return manager.add(id, out, forward)
        })
    }

    plugin.removeForward = function(id) {
      log.info('Removing reverse port forward "%s"', id)
      manager.remove(id)
      return Promise.resolve()
    }

    plugin.connect = function(options) {
      var resolve_: (conn: net.Socket) => void, reject_: (err: Error) => void
      var promise = new Promise<net.Socket>(function(resolve, reject) {
        resolve_ = resolve
        reject_ = reject
      })

      var conn = net.connect({
        host: options.targetHost
      , port: options.targetPort
      })

      function connectListener() {
        resolve_(conn)
      }

      function errorListener(err: Error) {
        reject_(err)
      }

      conn.on('connect', connectListener)
      conn.on('error', errorListener)

      return promise.finally(function() {
        conn.removeListener('connect', connectListener)
        conn.removeListener('error', errorListener)
      })
    }

    plugin.reset = function() {
      manager.removeAll(manager)
    }

    group.on('leave', plugin.reset)

    var pushForwards = _.debounce(
      function() {
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.ReverseForwardsEvent(
            options.serial
          , manager.listAll() as ReverseForward[]
          ))
        ])
      }
    , 200
    )

    manager.on('add', pushForwards)
    manager.on('remove', pushForwards)

    return startService()
      .then(awaitServer)
      .then(function() {
        router
          .on(wire.ForwardTestMessage, function(channel, message) {
            var reply = wireutil.reply(options.serial)
            plugin.connect(message)
              .then(function(conn) {
                conn.end()
                push.send([
                  channel
                , reply.okay('success')
                ])
              })
              .catch(function() {
                push.send([
                  channel
                , reply.fail('fail_connect')
                ])
              })
          })
          .on(wire.ForwardCreateMessage, function(channel, message) {
            var reply = wireutil.reply(options.serial)
            plugin.createForward(message.id, message)
              .then(function() {
                push.send([
                  channel
                , reply.okay('success')
                ])
              })
              .catch(function(err) {
                log.error('Reverse port forwarding failed', err.stack)
                push.send([
                  channel
                , reply.fail('fail_forward')
                ])
              })
          })
          .on(wire.ForwardRemoveMessage, function(channel, message) {
            var reply = wireutil.reply(options.serial)
            plugin.removeForward(message.id)
              .then(function() {
                push.send([
                  channel
                , reply.okay('success')
                ])
              })
              .catch(function(err) {
                log.error('Reverse port unforwarding failed', err.stack)
                push.send([
                  channel
                , reply.fail('fail')
                ])
              })
          })
      })
      .return(plugin)
  })
