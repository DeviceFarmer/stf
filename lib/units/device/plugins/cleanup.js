var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')
var _ = require('lodash')

var logger = require('../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../support/adb'))
  .dependency(require('../resources/service'))
  .dependency(require('./group'))
  .dependency(require('./service'))
  .define(function(options, adb, stfservice, group, service) {
    var log = logger.createLogger('device:plugins:cleanup')
    var plugin = Object.create(null)

    if (!options.cleanup) {
      return plugin
    }

    function listPackages() {
      return adb.getPackages(options.serial)
    }

    function uninstallPackage(pkg) {
      log.info('Cleaning up package "%s"', pkg)
      return adb.uninstall(options.serial, pkg)
        .catch(function(err) {
          log.warn('Unable to clean up package "%s"', pkg, err)
          return true
        })
    }

    return listPackages()
      .then(function(initialPackages) {
        initialPackages.push(stfservice.pkg)

        plugin.removePackages = function() {
          return listPackages()
            .then(function(currentPackages) {
              var remove = _.difference(currentPackages, initialPackages)
              return Promise.map(remove, uninstallPackage)
            })
        }
        plugin.disableBluetooth = function() {
          if (!options.cleanupDisableBluetooth) {
            return
          }
          return service.getBluetoothStatus()
            .then(function(enabled) {
              if (enabled) {
                log.info('Disabling Bluetooth')
                return service.setBluetoothEnabled(false)
              }
            })
        }
        plugin.cleanBluetoothBonds = function() {
          if (!options.cleanupBluetoothBonds) {
            return
          }
          log.info('Cleanup Bluetooth bonds')
          return service.cleanBluetoothBonds()
        }
        plugin.cleanTmpFolder = function() {
          if (!options.cleanupTmpFolder) {
            log.debug('Skipping tmp folder cleanup phase')
            return
          }
          log.info('Cleanup /data/local/tmp folder')
          return adb.readdir(options.serial, '/data/local/tmp')
            .then(function(files) {
              return Promise.map(files, function(file) {
                if (file.name === '.' || file.name === '..') {
                  return
                }
                var preserveFiles = [
                  'minicap.apk',
                  'minicap',
                  'minicap.so',
                  'minitouch',
                  'minirev'
                ]
                if (preserveFiles.indexOf(file.name) !== -1) {
                  log.debug('Skipping /data/local/tmp/%s', file.name)
                  return
                }
                log.info('Removing /data/local/tmp/%s', file.name)
                return adb
                  .shell(options.serial, 'rm -rf /data/local/tmp/' + file.name)
                  .catch(function(err) {
                    log.warn('Unable to clean /data/local/tmp folder', err)
                  })
              })
            })
            .catch(function(err) {
              log.warn('Unable to clean /data/local/tmp folder', err)
            })
        }

        group.on('leave', function() {
          Promise.all([
            plugin.removePackages()
          , plugin.cleanBluetoothBonds()
          , plugin.disableBluetooth()
          , plugin.cleanTmpFolder()])
        })
      })
      .return(plugin)
  })
