/**
* Copyright © 2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import adbkit from '@devicefarmer/adbkit'
import type {Client, DeviceClient, SocketOptions, StartActivityOptions} from '@devicefarmer/adbkit'
import type {Readable} from 'stream'

var require = createRequire(import.meta.url)

interface AdbOptions {
  adbHost: string
  adbPort: number
}

type LogcatOptions = Parameters<DeviceClient['openLogcat']>[0]
type ShellCommand = Parameters<DeviceClient['shell']>[0]

interface AdbWrapper {
  client: Client
  Keycode: typeof adbkit.KeyCodes
  Parser: typeof adbkit.Parser
  util: typeof adbkit.Adb.util
  readdir(serial: string, path: string): ReturnType<DeviceClient['readdir']>
  stat(serial: string, path: string): ReturnType<DeviceClient['stat']>
  openLocal(serial: string, path: string): ReturnType<DeviceClient['openLocal']>
  openLogcat(serial: string, options?: LogcatOptions): ReturnType<DeviceClient['openLogcat']>
  shell(serial: string, command: ShellCommand): ReturnType<DeviceClient['shell']>
  push(
    serial: string
  , contents: string | Readable
  , path: string
  , mode?: number
  ): ReturnType<DeviceClient['push']>
  pull(serial: string, path: string): ReturnType<DeviceClient['pull']>
  install(serial: string, apk: string | Readable): ReturnType<DeviceClient['install']>
  installRemote(serial: string, apk: string): ReturnType<DeviceClient['installRemote']>
  uninstall(serial: string, pkg: string): ReturnType<DeviceClient['uninstall']>
  clear(serial: string, pkg: string): ReturnType<DeviceClient['clear']>
  reboot(serial: string): ReturnType<DeviceClient['reboot']>
  waitBootComplete(serial: string): ReturnType<DeviceClient['waitBootComplete']>
  getPackages(serial: string): ReturnType<DeviceClient['getPackages']>
  getProperties(serial: string): ReturnType<DeviceClient['getProperties']>
  startActivity(
    serial: string
  , options: StartActivityOptions
  ): ReturnType<DeviceClient['startActivity']>
  createTcpUsbBridge(
    serial: string
  , options: SocketOptions
  ): ReturnType<Client['createTcpUsbBridge']>
  trackDevices(): ReturnType<Client['trackDevices']>
}

interface LegacyAdbkit {
  createClient(options?: {host?: string, port?: number}): AdbWrapper
  Keycode: AdbWrapper['Keycode']
  util: AdbWrapper['util']
}

export default function(options?: AdbOptions): AdbWrapper {
var adb: AdbWrapper | null = null

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
  , readdir: function(this: AdbWrapper, serial: string, path: string) {
      return this.client.getDevice(serial).readdir(path)
    }
  , stat: function(this: AdbWrapper, serial: string, path: string) {
      return this.client.getDevice(serial).stat(path)
    }
  , openLocal: function(this: AdbWrapper, serial: string, path: string) {
      return this.client.getDevice(serial).openLocal(path)
    }
  , openLogcat: function(this: AdbWrapper, serial: string, options?: LogcatOptions) {
      return this.client.getDevice(serial).openLogcat(options)
    }
  , shell: function(this: AdbWrapper, serial: string, command: ShellCommand) {
      return this.client.getDevice(serial).shell(command)
    }
  , push: function(
      this: AdbWrapper
    , serial: string
    , contents: string | Readable
    , path: string
    , mode?: number
    ) {
      return this.client.getDevice(serial).push(contents, path, mode)
    }
  , pull: function(this: AdbWrapper, serial: string, path: string) {
      return this.client.getDevice(serial).pull(path)
    }
  , install: function(this: AdbWrapper, serial: string, apk: string | Readable) {
      return this.client.getDevice(serial).install(apk)
    }
  , installRemote: function(this: AdbWrapper, serial: string, apk: string) {
      return this.client.getDevice(serial).installRemote(apk)
    }
  , uninstall: function(this: AdbWrapper, serial: string, pkg: string) {
      return this.client.getDevice(serial).uninstall(pkg)
    }
  , clear: function(this: AdbWrapper, serial: string, pkg: string) {
      return this.client.getDevice(serial).clear(pkg)
    }
  , reboot: function(this: AdbWrapper, serial: string) {
      return this.client.getDevice(serial).reboot()
    }
  , waitBootComplete: function(this: AdbWrapper, serial: string) {
      return this.client.getDevice(serial).waitBootComplete()
    }
  , getPackages: function(this: AdbWrapper, serial: string) {
      return this.client.getDevice(serial).getPackages()
    }
  , getProperties: function(this: AdbWrapper, serial: string) {
      return this.client.getDevice(serial).getProperties()
    }
  , startActivity: function(this: AdbWrapper, serial: string, options: StartActivityOptions) {
      return this.client.getDevice(serial).startActivity(options)
    }
  , createTcpUsbBridge: function(this: AdbWrapper, serial: string, options: SocketOptions) {
      return this.client.createTcpUsbBridge(serial, options)
    }
  , trackDevices: function(this: AdbWrapper) {
      return this.client.trackDevices()
    }
  }
}
else {
  // adbkit 2.x version
  adb = typeof options === 'undefined' ?
    (adbkit as unknown as LegacyAdbkit).createClient() :
    (adbkit as unknown as LegacyAdbkit).createClient({
      host: options.adbHost
    , port: options.adbPort
    })
  adb.Keycode = (adbkit as unknown as LegacyAdbkit).Keycode
  adb.Parser = require('@devicefarmer/adbkit/lib/adb/parser')
  adb.util = (adbkit as unknown as LegacyAdbkit).util
 }
return adb
}
