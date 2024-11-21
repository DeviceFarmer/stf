/**
* Copyright © 2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var adbkit = require('@devicefarmer/adbkit')

module.exports = function(options) {
var adb = null

if (adbkit.hasOwnProperty('Adb')) {
  // adbkit 3.x version
  adb = {
    client: typeof options === 'undefined' ?
      adbkit.Adb.createClient() :
      adbkit.Adb.createClient({
        host: options.adbHost
      , port: options.adbPort
      })
  , Keycode: adbkit.KeyCodes
  , Parser: adbkit.Parser
  , util: adbkit.Adb.util
  , readdir: function(serial, path) {
      return this.client.getDevice(serial).readdir(path)
    }
  , stat: function(serial, path) {
      return this.client.getDevice(serial).stat(path)
    }
  , openLocal: function(serial, path) {
      return this.client.getDevice(serial).openLocal(path)
    }
  , openLogcat: function(serial, options) {
      return this.client.getDevice(serial).openLogcat(options)
    }
  , shell: function(serial, command) {
      return this.client.getDevice(serial).shell(command)
    }
  , push: function(serial, contents, path, mode) {
      return this.client.getDevice(serial).push(contents, path, mode)
    }
  , pull: function(serial, path) {
      return this.client.getDevice(serial).pull(path)
    }
  , install: function(serial, apk) {
      return this.client.getDevice(serial).install(apk)
    }
  , installRemote: function(serial, apk) {
      return this.client.getDevice(serial).installRemote(apk)
    }
  , uninstall: function(serial, pkg) {
      return this.client.getDevice(serial).uninstall(pkg)
    }
  , clear: function(serial, pkg) {
      return this.client.getDevice(serial).clear(pkg)
    }
  , reboot: function(serial) {
      return this.client.getDevice(serial).reboot()
    }
  , waitBootComplete: function(serial) {
      return this.client.getDevice(serial).waitBootComplete()
    }
  , getPackages: function(serial) {
      return this.client.getDevice(serial).getPackages()
    }
  , getProperties: function(serial) {
      return this.client.getDevice(serial).getProperties()
    }
  , startActivity: function(serial, options) {
      return this.client.getDevice(serial).startActivity(options)
    }
  , createTcpUsbBridge: function(serial, options) {
      return this.client.createTcpUsbBridge(serial, options)
    }
  , trackDevices: function() {
      return this.client.trackDevices()
    }
  }
}
else {
  // adbkit 2.x version
  adb = typeof options === 'undefined' ?
    adbkit.createClient() :
    adbkit.createClient({
      host: options.adbHost
    , port: options.adbPort
    })
  adb.Keycode = adbkit.Keycode
  adb.Parser = require('@devicefarmer/adbkit/lib/adb/parser')
  adb.util = adbkit.util
 }
return adb
}
