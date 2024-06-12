var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')
var _ = require('lodash')

var logger = require('../../../util/logger')
const util = require('util')

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
    function removeFile(filename) {
      log.info('Removing %s', filename)
      return adb
        .shell(options.serial, util.format('rm -rf "%s"', filename))
        .catch(function(err) {
          log.warn(util.format('Unable to clean %s folder', filename), err)
        })
    }
    function listFiles(folder, ignoreFiles = []) {
       return adb.readdir(options.serial, folder)
            .then(function(files) {
              // drop . and .. from list
              return files.filter(function(file) {
                return file.name !== '.' && file.name !== '..'
              })
            })
            .then(function(files) {
              return files.map(function(file){
                return util.format('%s/%s', folder, file.name)
              })
            })
           .then(function(files) {
              return files.filter(function(file) {
                return !ignoreFiles.includes(file)
              })
           })
    }
    function cleanFolder(folder) {
      log.info('Cleanup %s folder', folder)
      var systemFolders = [
          '/system'
        , '/boot'
        , '/proc'
        , '/sbin'
        , '/vendor'
      ]
      // if folder starts with system folder, ignore it
      if (systemFolders.some(function(systemFolder) {
        return folder.startsWith(systemFolder)
      })) {
        log.warn('Warning, Tried to clean system folder. Ignoring: %s', folder)
        return
      }
      // ignore STF service files
      var ignoreServiceFiles = [
          '/data/local/tmp/minicap.apk'
        , '/data/local/tmp/minicap'
        , '/data/local/tmp/minicap.so'
        , '/data/local/tmp/minitouch'
        , '/data/local/tmp/minirev'
      ]
      return listFiles(folder, ignoreServiceFiles)
        .then(function(files) {
          return Promise.map(files, removeFile)
        })
        .catch(function(err) {
          log.warn('Unable to clean %s folder', folder, err)
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

        plugin.cleanFolders = function() {
          return Promise.all(options.cleanupFolders.map(cleanFolder))
        }

        group.on('leave', function() {
          Promise.all([
            plugin.removePackages()
          , plugin.cleanBluetoothBonds()
          , plugin.disableBluetooth()
          , plugin.cleanFolders()
          ])
        })
      })
      .return(plugin)
  })
