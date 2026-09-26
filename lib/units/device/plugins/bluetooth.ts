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
import serviceSyrup from './service.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'


export default syrup.serial()
  .dependency(serviceSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(
    options: DevicePluginOptions
  , service: ServicePlugin
  , router: Router
  , push: ZmqSocket
  ) {
    var log = logger.createLogger('device:plugins:bluetooth')

    router.on(wire.BluetoothSetEnabledMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      log.info('Setting Bluetooth "%s"', message.enabled)
      service.setBluetoothEnabled(message.enabled)
        .timeout(30000)
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Setting Bluetooth enabled failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })

    router.on(wire.BluetoothGetStatusMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      log.info('Getting Bluetooth status')
      service.getBluetoothStatus()
        .timeout(30000)
        .then(function(enabled) {
          push.send([
            channel
          , reply.okay(enabled ? 'bluetooth_enabled' : 'bluetooth_disabled')
          ])
        })
        .catch(function(err) {
          log.error('Getting Bluetooth status failed', err.stack)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })

    router.on(wire.BluetoothCleanBondedMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      log.info('Clean bonded Bluetooth devices')
      service.cleanupBondedBluetoothDevices()
        .timeout(30000)
        .then(function() {
          push.send([
            channel
            , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Cleaning Bluetooth bonded devices failed', err.stack)
          push.send([
            channel
            , reply.fail(err.message)
          ])
        })
    })
  })
