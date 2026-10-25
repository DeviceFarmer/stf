/**
* Copyright © 2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import Bluebird from 'bluebird'
import adbkit from '@devicefarmer/adbkit'
import type {
  Client
, DeviceClient
, SocketOptions
, StartActivityOptions
, WaitOptions
} from '@devicefarmer/adbkit'
import type {Readable} from 'stream'

interface AdbOptions {
  adbHost: string
  adbPort: number
}

type LogcatOptions = Parameters<DeviceClient['openLogcat']>[0]
type ShellCommand = Parameters<DeviceClient['shell']>[0]

// adbkit returns native promises, but stf chains Bluebird methods
// (.timeout(), .return(), .delay()) on them, so the wrapper converts.
type Wrapped<F extends (...args: never[]) => unknown> = Bluebird<Awaited<ReturnType<F>>>

interface AdbWrapper {
  client: Client
  Keycode: typeof adbkit.KeyCodes
  Parser: typeof adbkit.Parser
  util: typeof adbkit.Adb.util
  readdir(serial: string, path: string): Wrapped<DeviceClient['readdir']>
  stat(serial: string, path: string): Wrapped<DeviceClient['stat']>
  openLocal(serial: string, path: string): Wrapped<DeviceClient['openLocal']>
  openLogcat(serial: string, options?: LogcatOptions): Wrapped<DeviceClient['openLogcat']>
  shell(serial: string, command: ShellCommand): Wrapped<DeviceClient['shell']>
  push(
    serial: string
  , contents: string | Readable
  , path: string
  , mode?: number
  ): Wrapped<DeviceClient['push']>
  pull(serial: string, path: string): Wrapped<DeviceClient['pull']>
  install(serial: string, apk: string | Readable): Wrapped<DeviceClient['install']>
  installRemote(serial: string, apk: string): Wrapped<DeviceClient['installRemote']>
  uninstall(serial: string, pkg: string): Wrapped<DeviceClient['uninstall']>
  clear(serial: string, pkg: string): Wrapped<DeviceClient['clear']>
  reboot(serial: string): Wrapped<DeviceClient['reboot']>
  waitBootComplete(serial: string, options?: WaitOptions): Wrapped<DeviceClient['waitBootComplete']>
  getPackages(serial: string): Wrapped<DeviceClient['getPackages']>
  getProperties(serial: string): Wrapped<DeviceClient['getProperties']>
  startActivity(
    serial: string
  , options: StartActivityOptions
  ): Wrapped<DeviceClient['startActivity']>
  createTcpUsbBridge(
    serial: string
  , options: SocketOptions
  ): ReturnType<Client['createTcpUsbBridge']>
  // Not converted: the tracker emits the devices adb already lists right after
  // it resolves, before a Bluebird callback would get to attach the listeners
  trackDevices(): ReturnType<Client['trackDevices']>
}

export default function(options?: AdbOptions): AdbWrapper {
  return {
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
      return Bluebird.resolve(this.client.getDevice(serial).readdir(path))
    }
  , stat: function(serial, path) {
      return Bluebird.resolve(this.client.getDevice(serial).stat(path))
    }
  , openLocal: function(serial, path) {
      return Bluebird.resolve(this.client.getDevice(serial).openLocal(path))
    }
  , openLogcat: function(serial, options) {
      return Bluebird.resolve(this.client.getDevice(serial).openLogcat(options))
    }
  , shell: function(serial, command) {
      return Bluebird.resolve(this.client.getDevice(serial).shell(command))
    }
  , push: function(serial, contents, path, mode) {
      return Bluebird.resolve(this.client.getDevice(serial).push(contents, path, mode))
    }
  , pull: function(serial, path) {
      return Bluebird.resolve(this.client.getDevice(serial).pull(path))
    }
  , install: function(serial, apk) {
      return Bluebird.resolve(this.client.getDevice(serial).install(apk))
    }
  , installRemote: function(serial, apk) {
      return Bluebird.resolve(this.client.getDevice(serial).installRemote(apk))
    }
  , uninstall: function(serial, pkg) {
      return Bluebird.resolve(this.client.getDevice(serial).uninstall(pkg))
    }
  , clear: function(serial, pkg) {
      return Bluebird.resolve(this.client.getDevice(serial).clear(pkg))
    }
  , reboot: function(serial) {
      return Bluebird.resolve(this.client.getDevice(serial).reboot())
    }
  , waitBootComplete: function(serial, options) {
      return Bluebird.resolve(this.client.getDevice(serial).waitBootComplete(options))
    }
  , getPackages: function(serial) {
      return Bluebird.resolve(this.client.getDevice(serial).getPackages())
    }
  , getProperties: function(serial) {
      return Bluebird.resolve(this.client.getDevice(serial).getProperties())
    }
  , startActivity: function(serial, options) {
      return Bluebird.resolve(this.client.getDevice(serial).startActivity(options))
    }
  , createTcpUsbBridge: function(serial, options) {
      return this.client.createTcpUsbBridge(serial, options)
    }
  , trackDevices: function() {
      return this.client.trackDevices()
    }
  }
}
