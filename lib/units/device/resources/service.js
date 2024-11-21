/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var util = require('util')

var syrup = require('@devicefarmer/stf-syrup')
var ProtoBuf = require('protobufjs')
var semver = require('semver')
var Promise = require('bluebird')

var pathutil = require('../../../util/pathutil')
var streamutil = require('../../../util/streamutil')
var promiseutil = require('../../../util/promiseutil')
var logger = require('../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../support/adb'))
  .dependency(require('../support/sdk'))
  .define(function(options, adb, sdk) {
    var log = logger.createLogger('device:resources:service')
    var builder = ProtoBuf.loadProtoFile(
      pathutil.vendor('STFService/wire.proto'))

    var resource = {
      requiredVersion: '2.5.3'
    , pkg: 'jp.co.cyberagent.stf'
    , main: 'jp.co.cyberagent.stf.Agent'
    , apk: pathutil.vendor('STFService/STFService.apk')
    , wire: builder.build().jp.co.cyberagent.stf.proto
    , builder: builder
    , startIntent: {
        action: 'jp.co.cyberagent.stf.ACTION_START'
      , component: 'jp.co.cyberagent.stf/.Service'
      }
    }

    function getPath() {
      return adb.shell(options.serial, ['pm', 'path', resource.pkg])
        .timeout(10000)
        .then(function(out) {
          return streamutil.findLine(out, (/^package:/))
            .timeout(15000)
            .then(function(line) {
              return line.substr(8)
            })
        })
    }

    function install() {
      log.info('Checking whether we need to install STFService')
      return getPath()
        .then(function(installedPath) {
          log.info('Running version check')
          return adb.shell(options.serial, util.format(
            "export CLASSPATH='%s';" +
            " exec app_process /system/bin '%s' --version 2>/dev/null"
          , installedPath
          , resource.main
          ))
          .timeout(10000)
          .then(function(out) {
            return streamutil.readAll(out)
              .timeout(10000)
              .then(function(buffer) {
                var version = buffer.toString()
                if (semver.satisfies(version, resource.requiredVersion)) {
                  return installedPath
                }
                else {
                  throw new Error(util.format(
                    'Incompatible version %s'
                  , version
                  ))
                }
              })
          })
        })
        .catch(function() {
          log.info('Installing STFService')
          // Uninstall first to make sure we don't have any certificate
          // issues.
          return adb.uninstall(options.serial, resource.pkg)
            .timeout(15000)
            .then(function() {
              return promiseutil.periodicNotify(
                  adb.install(options.serial, resource.apk)
                , 20000
                )
                .timeout(65000)
            })
            .progressed(function() {
              log.warn(
                'STFService installation is taking a long time; ' +
                'perhaps you have to accept 3rd party app installation ' +
                'on the device?'
              )
            })
            .then(function() {
              return getPath()
            })
        })
    }

    function grantPermission(permission, minSdk) {
      if (minSdk && sdk.level < minSdk) {
        log.warn('SDK version (%d) is lower than %d, permission %s not supported',
          sdk.level, minSdk, permission)
        return Promise.resolve()
      }
      log.info('Granting permission to STFService: ' + permission)
      return adb.shell(options.serial, [
        'pm', 'grant', resource.pkg, permission])
        .then(adb.util.readAll)
        .then(function() {
          log.info('Permission granted %s', permission)
        })
        .catch(function(err) {
          log.error('Failed to grant permission %s: %s', permission, err)
          throw err
        })
    }
    function grantBluetoothPermission() {
      // https://developer.android.com/reference/android/Manifest.permission#BLUETOOTH_CONNECT
      // permission added in SDK 31 and above
      return grantPermission('android.permission.BLUETOOTH_CONNECT', 31)
    }
    function grantSystemPermission() {
      return grantPermission('android.permission.SYSTEM_ALERT_WINDOW')
    }

    function grantServicePermissions() {
      return grantBluetoothPermission()
        .then(grantSystemPermission)
    }

    return install()
      .then(function(path) {
        return grantServicePermissions()
          .then(function() {
            return path
          })
      })
      .then(function(path) {
        log.info('STFService up to date')
        resource.path = path
        return resource
      })
  })
