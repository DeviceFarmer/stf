var syrup = require('@devicefarmer/stf-syrup')
var DeviceClient = require('@devicefarmer/adbkit/dist/src/adb/DeviceClient').default

var logger = require('../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('./adb'))
  .define(function(options, adb) {
    var log = logger.createLogger('device:support:properties')

    function load() {
      log.info('Loading properties')
      return new DeviceClient(adb, options.serial).getProperties()
        .timeout(10000)
    }

    return load()
  })
