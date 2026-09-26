import util from 'util'

import syrup from '@devicefarmer/stf-syrup'

import streamutil from '../../../../util/streamutil.js'
import logger from '../../../../util/logger.js'
import type {Properties} from '@devicefarmer/adbkit'
import type {
  Adb
, DevicePluginOptions
, PhoneProperties
, ServicePlugin
, StfServiceResource
} from '../../../../types/device-plugins.js'
import adbSyrup from '../../support/adb.js'
import serviceResourceSyrup from '../../resources/service.js'
import serviceSyrup from '../service.js'
import propertiesSyrup from '../../support/properties.js'

var SUBSCRIBER_PROPERTIES = ['imei', 'imsi', 'phoneNumber', 'iccid']
var HANDSET_PROPERTIES = ['imei']

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
          var properties: PhoneProperties = Object.create(null)
          buffer.toString().split('\n').forEach(function(line) {
            var match = /^(imei|imsi|iccid|phoneNumber)=(.+)$/.exec(line.trim())
            if (match) {
              properties[match[1]!] = match[2]!
            }
          })
          return properties
        })
    }

    function hasUsableSim() {
      var state = deviceProperties['gsm.sim.state']
      if (!state) {
        return true
      }
      return state.split(',').some(function(slot) {
        var slotState = slot.trim()
        return slotState === 'READY' || slotState === 'LOADED'
      })
    }

    function missingSubscriberInfo(properties: PhoneProperties) {
      var wanted = hasUsableSim() ? SUBSCRIBER_PROPERTIES : HANDSET_PROPERTIES
      return wanted.filter(function(name) {
        return !properties[name]
      })
    }

    function complete(properties: PhoneProperties) {
      var missing = missingSubscriberInfo(properties)
      if (!missing.length) {
        return properties
      }

      log.info('Missing %s, asking the agent', missing.join(', '))
      return fetchFromAgent()
        .then(function(fromAgent) {
          SUBSCRIBER_PROPERTIES.forEach(function(name) {
            if (!properties[name] && fromAgent[name]) {
              properties[name] = fromAgent[name]
            }
          })
          return properties
        })
        .catch(function(err) {
          log.warn('Unable to fetch subscriber info from the agent: %s', err.message)
          return properties
        })
    }

    return fetch().then(complete)
  })
