var util = require('util')

var syrup = require('@devicefarmer/stf-syrup')

var streamutil = require('../../../../util/streamutil')
var logger = require('../../../../util/logger')

var SUBSCRIBER_PROPERTIES = ['imei', 'imsi', 'phoneNumber', 'iccid']
var HANDSET_PROPERTIES = ['imei']

module.exports = syrup.serial()
  .dependency(require('../../support/adb'))
  .dependency(require('../../resources/service'))
  .dependency(require('../service'))
  .dependency(require('../../support/properties'))
  .define(function(options, adb, apk, service, deviceProperties) {
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
          var properties = Object.create(null)
          buffer.toString().split('\n').forEach(function(line) {
            var match = /^(imei|imsi|iccid|phoneNumber)=(.+)$/.exec(line.trim())
            if (match) {
              properties[match[1]] = match[2]
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

    function missingSubscriberInfo(properties) {
      var wanted = hasUsableSim() ? SUBSCRIBER_PROPERTIES : HANDSET_PROPERTIES
      return wanted.filter(function(name) {
        return !properties[name]
      })
    }

    function complete(properties) {
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
