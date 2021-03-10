var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')
var _ = require('lodash')

var logger = require('../../../util/logger')
var DeviceClient = require('@devicefarmer/adbkit/dist/src/adb/DeviceClient').default

module.exports = syrup.serial()
  .dependency(require('../support/adb'))
  .dependency(require('../resources/service'))
  .dependency(require('./group'))
  .define(function(options, adb, service, group) {
    var deviceClient = new DeviceClient(adb, options.serial)
    var log = logger.createLogger('device:plugins:cleanup')
    var plugin = Object.create(null)

    if (!options.cleanup) {
      return plugin
    }

    function listPackages() {
      return deviceClient.getPackages()
    }

    function uninstallPackage(pkg) {
      log.info('Cleaning up package "%s"', pkg)
      return deviceClient.uninstall(pkg)
        .catch(function(err) {
          log.warn('Unable to clean up package "%s"', pkg, err)
          return true
        })
    }

    return listPackages()
      .then(function(initialPackages) {
        initialPackages.push(service.pkg)

        plugin.removePackages = function() {
          return listPackages()
            .then(function(currentPackages) {
              var remove = _.difference(currentPackages, initialPackages)
              return Promise.map(remove, uninstallPackage)
            })
        }

        group.on('leave', function() {
          plugin.removePackages()
        })
      })
      .return(plugin)
  })
