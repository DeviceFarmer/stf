import util from 'util'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import streamutil from '../../../../util/streamutil.js'
import logger from '../../../../util/logger.js'
import type {Properties} from '@devicefarmer/adbkit'
import type {
  Adb
, DevicePluginOptions
, PhoneProperties
, RefreshablePhoneProperties
, ServicePlugin
, StfServiceResource
} from '../../../../types/device-plugins.js'
import adbSyrup from '../../support/adb.js'
import serviceResourceSyrup from '../../resources/service.js'
import serviceSyrup from '../service.js'
import propertiesSyrup from '../../support/properties.js'

export var SUBSCRIBER_PROPERTIES = ['imei', 'imsi', 'phoneNumber', 'iccid']
var HANDSET_PROPERTIES = ['imei']
var AGENT_RETRIES = 5
var AGENT_RETRY_DELAY = 1000

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(serviceResourceSyrup)
  .dependency(serviceSyrup)
  .dependency(propertiesSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , apk: StfServiceResource
  , service: ServicePlugin
  , deviceProperties: Properties
  ) {
    var log = logger.createLogger('device:plugins:phone')

    function fetch() {
      log.info('Fetching phone info')
      return service.getProperties([
        'imei'
      , 'imsi'
      , 'phoneNumber'
      , 'iccid'
      , 'network'
      ])
    }

    function fetchFromAgent() {
      log.info('Fetching subscriber info from the agent')
      return adb.shell(options.serial, util.format(
        "export CLASSPATH='%s';" +
        ' if [ "$(id -u)" = 0 ] && command -v su >/dev/null 2>&1;' +
        ' then set -- su shell; else set --; fi;' +
        ' exec "$@" app_process /system/bin \'%s\' --telephony'
      , apk.path
      , apk.main
      ))
        .timeout(15000)
        .then(function(out) {
          return streamutil.readAll(out)
            .timeout(10000)
        })
        .then(function(buffer) {
          var text = buffer.toString()
          var properties: PhoneProperties = Object.create(null)
          text.split('\n').forEach(function(line) {
            var match = /^(imei|imsi|iccid|phoneNumber)=(.+)$/.exec(line.trim())
            if (match) {
              properties[match[1]!] = match[2]!
            }
          })
          return {
            properties: properties
          , unsupported: /unknown argument/i.test(text)
          }
        })
    }

    function hasConfirmedSim(simState: string) {
      if (!simState) {
        return false
      }
      return simState.split(',').some(function(slot) {
        var slotState = slot.trim()
        return slotState === 'READY' || slotState === 'LOADED'
      })
    }

    function hasUsableSim(simState: string) {
      if (!simState) {
        return true
      }
      return hasConfirmedSim(simState)
    }

    // Only a state confirming absence in every slot makes a missing ICCID a
    // removal worth reporting; NOT_READY, UNKNOWN and friends just mean the
    // card could not be read yet.
    function confirmsNoSim(simState: string) {
      if (!simState) {
        return false
      }
      return simState.split(',').every(function(slot) {
        return slot.trim() === 'ABSENT'
      })
    }

    function missingSubscriberInfo(properties: PhoneProperties, simState: string) {
      var wanted = hasUsableSim(simState) ? SUBSCRIBER_PROPERTIES : HANDSET_PROPERTIES
      return wanted.filter(function(name) {
        return !properties[name]
      })
    }

    // The startup snapshot of gsm.sim.state goes stale the moment a SIM card
    // is inserted or removed, so refreshes must read it again to know which
    // properties to expect.
    function readSimState(): Promise<string> {
      return adb.getProperties(options.serial)
        .timeout(10000)
        .then(function(properties: Properties) {
          return properties['gsm.sim.state'] || ''
        })
        .catch(function(err: Error) {
          log.warn('Unable to read the SIM state: %s', err.message)
          return ''
        })
    }

    function complete(properties: PhoneProperties, simState: string, retries?: number) {
      var maxRetries: number
      if (typeof retries === 'number') {
        maxRetries = retries
      }
      else if (typeof options.phoneRetries === 'number') {
        maxRetries = options.phoneRetries
      }
      else {
        maxRetries = AGENT_RETRIES
      }
      var retryDelay = typeof options.phoneRetryDelay === 'number' ?
        options.phoneRetryDelay :
        AGENT_RETRY_DELAY

      // gsm.sim.state transitions to READY before SIMRecords finishes reading
      // EF_MSISDN (phoneNumber) or SubscriptionDatabaseManager populates the
      // active subscription row on fresh boots. When a SIM is confirmed present
      // and the agent supports --telephony, retry briefly if subscriber fields
      // are still empty.
      function queryAgent(retriesLeft: number): Promise<PhoneProperties> {
        var missing = missingSubscriberInfo(properties, simState)
        if (!missing.length) {
          return Promise.resolve(properties)
        }

        log.info('Missing %s, asking the agent', missing.join(', '))
        return fetchFromAgent()
          .then(function(result) {
            SUBSCRIBER_PROPERTIES.forEach(function(name) {
              if (!properties[name] && result.properties[name]) {
                properties[name] = result.properties[name]
              }
            })
            if (
              retriesLeft > 0 &&
              hasConfirmedSim(simState) &&
              !result.unsupported &&
              missingSubscriberInfo(properties, simState).length > 0
            ) {
              return Promise.delay(retryDelay).then(function() {
                return queryAgent(retriesLeft - 1)
              })
            }
            return properties
          })
          .catch(function(err) {
            log.warn('Unable to fetch subscriber info from the agent: %s', err.message)
            return properties
          })
      }

      return queryAgent(maxRetries)
    }

    // Kept non-enumerable so that the value still copies and serializes as
    // plain phone properties wherever it is consumed.
    function attachRefresh(
      properties: PhoneProperties
    , method: () => Promise<PhoneProperties | null>
    ): RefreshablePhoneProperties {
      Object.defineProperty(properties, 'refresh', {
        value: method
      })
      return properties as RefreshablePhoneProperties
    }

    // Null means the identifiers could not be read conclusively and the poll
    // should be skipped: without an ICCID, only a SIM state confirming
    // absence in every slot is a removal; anything else is a read the next
    // tick can retry, not an event.
    function refresh(): Promise<PhoneProperties | null> {
      return readSimState().then(function(simState: string) {
        return fetch()
          .then(function(properties: PhoneProperties) {
            // The interval does the retrying on refreshes, so a card whose
            // records are still loading is caught by the next tick instead
            // of spinning the agent retry loop every time.
            return complete(properties, simState, 0)
          })
          .then(function(completed: PhoneProperties) {
            if (!completed.iccid && !confirmsNoSim(simState)) {
              return null
            }
            return attachRefresh(completed, refresh)
          })
      })
    }

    return fetch().then(function(properties) {
      return complete(properties, deviceProperties['gsm.sim.state'] || '')
    }).then(function(properties) {
      return attachRefresh(properties, refresh)
    })
  })
