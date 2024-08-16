var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')
var _ = require('lodash')

var logger = require('../../../util/logger')
const util = require('util')
const adbkit = require('@devicefarmer/adbkit')

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

    // ignore system folders. This is to prevent accidental deletion of system files.
    // It's admin's responsibility to set correct cleanup folders.
    var systemFolders = [
        '/system'
      , '/boot'
      , '/proc'
      , '/vendor'
      , '/dev'
      , '/sys'
    ]
    // if folder starts with system folder, throw an error and stop provider.
    // this is to prevent accidental deletion of system files.
    options.cleanupFolder.forEach(function(folder) {
      if (systemFolders.some(function(systemFolder) {
        return folder.startsWith(systemFolder)
      })) {
        log.warn('Warning, Tried to clean system folder. Ignoring: %s', folder)
        throw new Error(util.format('Cleanup %s is not allowed!', folder))
      }
    })
    log.debug('Cleanup folders: %j', options.cleanupFolder)

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
      return adb
        // get file size
        .shell(options.serial, util.format('du -h "%s"', filename))
        .then(adbkit.util.readAll)
        .then(function(output) {
          // output is in format: size filename. extract size;
          var size = output.toString().split('\t')[0]
          log.info('Removing %s (%s)', filename, size)
          return adb
            .shell(options.serial, util.format('rm -rf "%s"', filename))
            .then(adbkit.util.readAll)
        })
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
              return files.map(function(file) {
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
          return Promise.each(options.cleanupFolder, cleanFolder)
        }

        group.on('leave', function() {
          Promise.each([
              plugin.removePackages
            , plugin.cleanBluetoothBonds
            , plugin.disableBluetooth
            , plugin.cleanFolders
            , function() {
              log.debug('Cleanup done')
            }
          ], function(fn) {
            return fn()
          })
        })
      })
      .return(plugin)
  })
