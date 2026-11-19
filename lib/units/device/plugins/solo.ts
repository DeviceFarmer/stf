/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import crypto from 'crypto'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import lifecycle from '../../../util/lifecycle.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {
  DeviceData
, DeviceIdentity
, DevicePluginOptions
, RefreshablePhoneProperties
, Router
, SoloPlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import subSyrup from '../support/sub.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import identitySyrup from './util/identity.js'
import phoneSyrup from './util/phone.js'
import dataSyrup from './util/data.js'

export default syrup.serial()
  .dependency(subSyrup)
  .dependency(pushSyrup)
  .dependency(routerSyrup)
  .dependency(identitySyrup)
  .dependency(phoneSyrup)
  .dependency(dataSyrup)
  .define(function(
    options: DevicePluginOptions
  , sub: ZmqSocket
  , push: ZmqSocket
  , router: Router
  , identity: DeviceIdentity
  , phone: RefreshablePhoneProperties
  , data?: DeviceData | null
  ): SoloPlugin {
    var log = logger.createLogger('device:plugins:solo')

    // The channel should keep the same value between restarts, so that
    // having the client side up to date all the time is not horribly painful.
    function makeChannelId() {
      var hash = crypto.createHash('sha1')
      hash.update(options.serial)
      return hash.digest('base64')
    }

    var channel = makeChannelId()

    var SUBSCRIBER_PROPERTIES = ['imei', 'imsi', 'phoneNumber', 'iccid']

    function pushIdentity() {
      var cpu = data && data.cpu &&
        (data.cpu.name !== null || data.cpu.cores !== null || data.cpu.freq !== null) ?
        new wire.DeviceCpuMessage(data.cpu) :
        null
      var memory = data && data.memory &&
        (data.memory.ram !== null || data.memory.rom !== null) ?
        new wire.DeviceMemoryMessage(data.memory) :
        null
      var releasedAt = (data && data.date) || null

      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceIdentityMessage(
          options.serial
        , identity.platform
        , identity.manufacturer
        , identity.operator
        , identity.model
        , identity.version
        , identity.abi
        , identity.sdk
        , new wire.DeviceDisplayMessage(identity.display)
        , new wire.DevicePhoneMessage(Object.assign({}, identity.phone))
        , identity.product
        , identity.cpuPlatform
        , identity.openGLESVersion
        , identity.marketName
        , cpu
        , memory
        , releasedAt
        ))
      ])
    }

    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)

    router.on(wire.ProbeMessage, pushIdentity)

    // SIM cards are otherwise only read when the device connects, so a card
    // swapped while it stays connected would go unnoticed until it reconnects.
    var refreshInterval = typeof options.simRefreshInterval === 'number' ?
      options.simRefreshInterval : 0

    if (refreshInterval > 0) {
      // Only one refresh in flight: adb answers slowly at times, and an
      // overlapping read finishing late could publish an older state over a
      // newer one. A null result means the read was inconclusive and this
      // poll is skipped rather than reported as a removal.
      var refreshing = false
      var timer = setInterval(function() {
        if (refreshing) {
          return
        }
        refreshing = true
        phone.refresh()
          .then(function(fresh) {
            if (fresh) {
              var changed = SUBSCRIBER_PROPERTIES.some(function(name) {
                return (identity.phone[name] || null) !== (fresh[name] || null)
              })
              if (changed) {
                log.info('Phone info changed, repushing identity')
                identity.phone = fresh
                pushIdentity()
              }
            }
            return null
          })
          .catch(function(err) {
            log.warn('Unable to refresh phone info: %s', err.message)
          })
          .finally(function() {
            refreshing = false
          })
      }, refreshInterval)

      lifecycle.observe(function() {
        clearInterval(timer)
      })
    }

    return {
      channel: channel
    , poke: function() {
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceReadyMessage(
            options.serial
          , channel
          ))
        ])
      }
    }
  })
