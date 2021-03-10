var syrup = require('@devicefarmer/stf-syrup')

var adbkit = require('@devicefarmer/adbkit').Adb
var DeviceClient = require('@devicefarmer/adbkit/dist/src/adb/DeviceClient').default

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
      return promiseutil.periodicNotify(
          new DeviceClient(adb, options.serial).waitBootComplete()
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
