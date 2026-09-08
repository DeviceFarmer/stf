/**
* Copyright © 2019-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var Promise = require('bluebird')

var logger = require('../../util/logger')
var wire = require('../../wire')
var wirerouter = require('../../wire/router')
var wireutil = require('../../wire/util')
var db = require('../../db')
var dbapi = require('../../db/api')
var lifecycle = require('../../util/lifecycle')
var deviceutil = require('../../util/deviceutil')
var srv = require('../../util/srv')
var zmqutil = require('../../util/zmqutil')

module.exports = db.ensureConnectivity(function(options) {
  var log = logger.createLogger('processor')

  if (options.name) {
    logger.setGlobalIdentifier(options.name)
  }

  // Said out loud because it is fleet-wide policy set per process: a fleet whose processors
  // disagree restores an arbitrary subset of departures, with nothing else to show for it.
  log.info('Automatic owner restore is %s', options.autoRestoreOwner ? 'on' : 'off')

  // App side
  var appDealer = zmqutil.socket('dealer')
  Promise.map(options.endpoints.appDealer, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('App dealer connected to "%s"', record.url)
        appDealer.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to app dealer endpoint', err)
    lifecycle.fatal()
  })

  // Device side
  var devDealer = zmqutil.socket('dealer')

  appDealer.on('message', function(channel, data) {
    devDealer.send([channel, data])
  })

  Promise.map(options.endpoints.devDealer, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Device dealer connected to "%s"', record.url)
        devDealer.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to dev dealer endpoint', err)
    lifecycle.fatal()
  })

  // Puts a device into a user's group without them asking, for the three cases where the system
  // knows who it belongs to: an adb fingerprint, a VNC response, and a claim held over a reboot.
  function sendAutoGroup(deviceChannel, user, identifier) {
    devDealer.send([
      deviceChannel
    , wireutil.envelope(new wire.AutoGroupMessage(
        new wire.OwnerMessage(
          user.email
        , user.name
        , user.group
        )
      , identifier
      ))
    ])
  }

  // Hands a device that only left to reboot back to whoever was using it, by replaying the join
  // its dead worker can no longer do. Settles the claim either way, so it never outlives one boot.
  function restoreDeviceOwner(device, deviceChannel) {
    if (!device || !device.restoreOwner) {
      return Promise.resolve()
    }

    var claim = device.restoreOwner

    // Everything but the user's group access is on the row already, so an expired or superseded
    // claim is dropped without a users read. Expiry is the common case, on any boot that ran long.
    if (!deviceutil.isClaimLive(device, Date.now())) {
      log.info('Not restoring device "%s" to "%s"', device.serial, claim.email)
      return dbapi.clearDeviceRestoreOwner(device.serial)
    }

    // The claim stays on the row until the join lands and clears it, because it is what stops the
    // device being handed to someone else in the moment between being ready and being owned again
    return dbapi.loadUser(claim.email)
      .then(function(user) {
        if (!deviceutil.isRestorable(device, user, Date.now())) {
          log.info(
            'Not restoring device "%s" to "%s"'
          , device.serial
          , claim.email
          )
          return dbapi.clearDeviceRestoreOwner(device.serial)
        }

        log.important('Restoring device "%s" to "%s"', device.serial, user.email)

        return sendAutoGroup(deviceChannel, user, claim.usage || '')
      })
      .catch(function(err) {
        log.error(
          'Unable to restore the owner of device "%s"'
        , device.serial
        , err.stack
        )
      })
  }

  devDealer.on('message', wirerouter()
    .on(wire.UpdateAccessTokenMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.DeleteUserMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.DeviceChangeMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.UserChangeMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.GroupChangeMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.DeviceGroupChangeMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.GroupUserChangeMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    // Initial device message
    .on(wire.DeviceIntroductionMessage, function(channel, message) {
      dbapi.saveDeviceInitialState(message.serial, message)
        .then(function(device) {
          devDealer.send([
            message.provider.channel
          , wireutil.envelope(new wire.DeviceRegisteredMessage(
              message.serial
            ))
          ])
          appDealer.send([
            channel
            , wireutil.envelope(new wire.DeviceIntroductionMessage(
                message.serial
              , message.status
              , new wire.ProviderMessage(
                  message.provider.channel
                , message.provider.name
                )
              , message.statusTimeStamp
              , new wire.DeviceGroupMessage(
                  device.group.id
                , device.group.name
                , new wire.DeviceGroupOwnerMessage(
                    device.group.owner.email
                  , device.group.owner.name
                  )
                , new wire.DeviceGroupLifetimeMessage(
                    device.group.lifeTime.start.getTime()
                  , device.group.lifeTime.stop.getTime()
                  )
                , device.group.class
                , device.group.repetitions
                , device.group.originName
                )
              ))
          ])
        })
        .catch(function(err) {
          log.error(
           'Unable to save the initial state of Device "%s"'
          , message.serial
          , err.stack
          )
        })
    })
    // Workerless messages
    .on(wire.DevicePresentMessage, function(channel, message, data) {
      dbapi.setDevicePresent(message.serial)
      appDealer.send([channel, data])
    })
    .on(wire.DeviceAbsentMessage, function(channel, message, data) {
      // Off by default: a device that disappears releases its owner, as it always has. Turned on,
      // every departure of a device in use is treated as a reboot it will come back from, whether
      // that was a reboot, a pulled cable or a reaped heartbeat.
      if (options.autoRestoreOwner) {
        dbapi.reserveDeviceOwner(message.serial)
          .catch(function(err) {
            log.error(
              'Unable to reserve the owner of device "%s"'
            , message.serial
            , err.stack
            )
          })
      }
      dbapi.setDeviceAbsent(message.serial)
      appDealer.send([channel, data])
    })
    .on(wire.DeviceStatusMessage, function(channel, message, data) {
      dbapi.saveDeviceStatus(message.serial, message.status, message.statusTimeStamp)
        .then(function(stats) {
          if (stats.replaced) {
            appDealer.send([channel, data])
          }
        })
    })
    .on(wire.DeviceHeartbeatMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    // Worker initialized
    .on(wire.DeviceReadyMessage, function(channel, message, data) {
      dbapi.setDeviceReady(message.serial, message.channel)
        .then(function(stats) {
          devDealer.send([
            message.channel
          , wireutil.envelope(new wire.ProbeMessage())
          ])

          // Settled before the device is announced, so it is never offered to anyone else first
          return restoreDeviceOwner(
            stats.changes && stats.changes[0] ? stats.changes[0].new_val : null
          , message.channel
          )
        })
        .then(function() {
          appDealer.send([channel, data])
        })
    })
    // Worker messages
    .on(wire.JoinGroupByAdbFingerprintMessage, function(channel, message) {
      dbapi.lookupUserByAdbFingerprint(message.fingerprint)
        .then(function(user) {
          if (user) {
            sendAutoGroup(channel, user, message.fingerprint)
          }
          else if (message.currentGroup) {
            appDealer.send([
              message.currentGroup
            , wireutil.envelope(new wire.JoinGroupByAdbFingerprintMessage(
                message.serial
              , message.fingerprint
              , message.comment
              ))
            ])
          }
        })
        .catch(function(err) {
          log.error(
            'Unable to lookup user by ADB fingerprint "%s"'
          , message.fingerprint
          , err.stack
          )
        })
    })
    .on(wire.JoinGroupByVncAuthResponseMessage, function(channel, message) {
      dbapi.lookupUserByVncAuthResponse(message.response, message.serial)
        .then(function(user) {
          if (user) {
            sendAutoGroup(channel, user, message.response)
          }
          else if (message.currentGroup) {
            appDealer.send([
              message.currentGroup
            , wireutil.envelope(new wire.JoinGroupByVncAuthResponseMessage(
                message.serial
              , message.response
              ))
            ])
          }
        })
        .catch(function(err) {
          log.error(
            'Unable to lookup user by VNC auth response "%s"'
          , message.response
          , err.stack
          )
        })
    })
    .on(wire.ConnectStartedMessage, function(channel, message, data) {
      dbapi.setDeviceConnectUrl(message.serial, message.url)
      appDealer.send([channel, data])
    })
    .on(wire.ConnectStoppedMessage, function(channel, message, data) {
      dbapi.unsetDeviceConnectUrl(message.serial)
      appDealer.send([channel, data])
    })
    .on(wire.JoinGroupMessage, function(channel, message, data) {
      dbapi.setDeviceOwner(message.serial, message.owner)
      if (message.usage) {
        dbapi.setDeviceUsage(message.serial, message.usage)
      }
      appDealer.send([channel, data])
    })
    .on(wire.LeaveGroupMessage, function(channel, message, data) {
      dbapi.unsetDeviceOwner(message.serial, message.owner)
      dbapi.unsetDeviceUsage(message.serial)
      appDealer.send([channel, data])
    })
    .on(wire.DeviceLogMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.DeviceIdentityMessage, function(channel, message, data) {
      dbapi.saveDeviceIdentity(message.serial, message)
      appDealer.send([channel, data])
    })
    .on(wire.TransactionProgressMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.TransactionDoneMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.DeviceLogcatEntryMessage, function(channel, message, data) {
      appDealer.send([channel, data])
    })
    .on(wire.AirplaneModeEvent, function(channel, message, data) {
      dbapi.setDeviceAirplaneMode(message.serial, message.enabled)
      appDealer.send([channel, data])
    })
    .on(wire.BatteryEvent, function(channel, message, data) {
      dbapi.setDeviceBattery(message.serial, message)
      appDealer.send([channel, data])
    })
    .on(wire.DeviceBrowserMessage, function(channel, message, data) {
      dbapi.setDeviceBrowser(message.serial, message)
      appDealer.send([channel, data])
    })
    .on(wire.ConnectivityEvent, function(channel, message, data) {
      dbapi.setDeviceConnectivity(message.serial, message)
      appDealer.send([channel, data])
    })
    .on(wire.PhoneStateEvent, function(channel, message, data) {
      dbapi.setDevicePhoneState(message.serial, message)
      appDealer.send([channel, data])
    })
    .on(wire.RotationEvent, function(channel, message, data) {
      dbapi.setDeviceRotation(message.serial, message.rotation)
      appDealer.send([channel, data])
    })
    .on(wire.ReverseForwardsEvent, function(channel, message, data) {
      dbapi.setDeviceReverseForwards(message.serial, message.forwards)
      appDealer.send([channel, data])
    })
    .handler())

  lifecycle.observe(function() {
    [appDealer, devDealer].forEach(function(sock) {
      try {
        sock.close()
      }
      catch (err) {
        // No-op
      }
    })
  })
})
