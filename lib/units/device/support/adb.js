var syrup = require('@devicefarmer/stf-syrup')

var adbkit = require('@devicefarmer/adbkit').Adb
var deviceClient = require('@devicefarmer/adbkit').DeviceClient

var logger = require('../../../util/logger')
var promiseutil = require('../../../util/promiseutil')

module.exports = syrup.serial()
  .define(function(options) {
    var log = logger.createLogger('device:support:adb')
    var adb = adbkit.createClient({
      host: options.adbHost
    , port: options.adbPort
    })
    adb.Keycode = adbkit.Keycode

    function ensureBootComplete() {
      var client = new deviceClient(adb, options.serial);
      return promiseutil.periodicNotify(
          client.waitBootComplete()
        , 1000
        )
        .progressed(function() {
          log.info('Waiting for boot to complete')
        })
        .timeout(options.bootCompleteTimeout)
    }

    return ensureBootComplete()
      .return(adb)
  })
