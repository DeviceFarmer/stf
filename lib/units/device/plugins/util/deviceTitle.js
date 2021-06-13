var syrup = require('@devicefarmer/stf-syrup')

var logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../service'))

  .define(function(options, service) {
    const log = logger.createLogger('device:support:deviceTitle')

    function load() {
      log.info('Loading properties')
      return service.getDeviceTitle(options.serial)
        .timeout(20000)
    }

    return load()
  })
