import {api} from './api'
import {emit} from './socket'
import {createTransaction, type ProgressPromise, type TransactionResult} from './transaction'
import keycodesMapped from './keycodes-mapped.json'
import type {Device} from './devices/types'

const mappedKeys = keycodesMapped as Record<string, string>

type TxPromise = ProgressPromise<TransactionResult<Device>>

export interface ForwardSpec {
  id?: string
  devicePort?: number | string
  targetHost: string
  targetPort: number | string
}

export interface Browser {
  id: string
  [key: string]: unknown
}

export interface InstallOptions {
  href: string
  manifest: any
  launch: boolean
  [key: string]: unknown
}

export function createControl(target: Device, channel: string) {
  function sendOneWay(action: string, data?: unknown) {
    emit(action, channel, data)
  }

  function sendTwoWay(action: string, data?: unknown): TxPromise {
    const tx = createTransaction(target)
    emit(action, channel, tx.channel, data)
    return tx.promise
  }

  function keySender(type: string, fixedKey?: string) {
    return (key?: string | number) => {
      if (typeof key === 'string') {
        sendOneWay(type, {key})
      }
      else {
        const mapped = fixedKey || (key !== undefined ? mappedKeys[String(key)] : undefined)
        if (mapped) {
          sendOneWay(type, {key: mapped})
        }
      }
    }
  }

  return {
    target
    , channel
    , gestureStart: (seq: number) => sendOneWay('input.gestureStart', {seq})
    , gestureStop: (seq: number) => sendOneWay('input.gestureStop', {seq})
    , touchDown: (seq: number, contact: number, x: number, y: number, pressure?: number) =>
      sendOneWay('input.touchDown', {seq, contact, x, y, pressure})
    , touchMove: (seq: number, contact: number, x: number, y: number, pressure?: number) =>
      sendOneWay('input.touchMove', {seq, contact, x, y, pressure})
    , touchUp: (seq: number, contact: number) => sendOneWay('input.touchUp', {seq, contact})
    , touchCommit: (seq: number) => sendOneWay('input.touchCommit', {seq})
    , touchReset: (seq: number) => sendOneWay('input.touchReset', {seq})
    , keyDown: keySender('input.keyDown')
    , keyUp: keySender('input.keyUp')
    , keyPress: keySender('input.keyPress')
    , home: keySender('input.keyPress', 'home')
    , menu: keySender('input.keyPress', 'menu')
    , back: keySender('input.keyPress', 'back')
    , appSwitch: keySender('input.keyPress', 'app_switch')
    , type: (text: string) => sendOneWay('input.type', {text})
    , paste: (text: string) => sendTwoWay('clipboard.paste', {text})
    , copy: () => sendTwoWay('clipboard.copy')
    , shell: (command: string) => sendTwoWay('shell.command', {command, timeout: 10000})
    , identify: () => sendTwoWay('device.identify')
    , install: (options: InstallOptions) => sendTwoWay('device.install', options)
    , uninstall: (packageName: string) => sendTwoWay('device.uninstall', {packageName})
    , reboot: () => sendTwoWay('device.reboot')
    , rebootAndKeep: () =>
      api.post(`/api/v1/user/devices/${target.serial}/reboot?keepOwnership=true`)
    , rotate: (rotation: number, lock?: boolean) =>
      sendOneWay('display.rotate', {rotation, lock})
    , testForward: (forward: ForwardSpec) => sendTwoWay('forward.test', {
      targetHost: forward.targetHost
      , targetPort: Number(forward.targetPort)
    })
    , createForward: (forward: ForwardSpec) => sendTwoWay('forward.create', {
      id: forward.id
      , devicePort: Number(forward.devicePort)
      , targetHost: forward.targetHost
      , targetPort: Number(forward.targetPort)
    })
    , removeForward: (forward: ForwardSpec) => sendTwoWay('forward.remove', {id: forward.id})
    , startLogcat: (filters: unknown[]) => sendTwoWay('logcat.start', {filters})
    , stopLogcat: () => sendTwoWay('logcat.stop')
    , startRemoteConnect: () => sendTwoWay('connect.start')
    , stopRemoteConnect: () => sendTwoWay('connect.stop')
    , openBrowser: (url: string, browser?: Browser | null) =>
      sendTwoWay('browser.open', {url, browser: browser ? browser.id : null})
    , clearBrowser: (browser: Browser) => sendTwoWay('browser.clear', {browser: browser.id})
    , openStore: () => sendTwoWay('store.open')
    , screenshot: () => sendTwoWay('screen.capture')
    , fsretrieve: (file: string) => sendTwoWay('fs.retrieve', {file})
    , fslist: (dir: string) => sendTwoWay('fs.list', {dir})
    , checkAccount: (type: string, account: string) =>
      sendTwoWay('account.check', {type, account})
    , removeAccount: (type: string, account: string) =>
      sendTwoWay('account.remove', {type, account})
    , addAccountMenu: () => sendTwoWay('account.addmenu')
    , addAccount: (user: string, password: string) =>
      sendTwoWay('account.add', {user, password})
    , getAccounts: (type: string) => sendTwoWay('account.get', {type})
    , getSdStatus: () => sendTwoWay('sd.status')
    , setRingerMode: (mode: string) => sendTwoWay('ringer.set', {mode})
    , getRingerMode: () => sendTwoWay('ringer.get')
    , setWifiEnabled: (enabled: boolean) => sendTwoWay('wifi.set', {enabled})
    , getWifiStatus: () => sendTwoWay('wifi.get')
    , setBluetoothEnabled: (enabled: boolean) => sendTwoWay('bluetooth.set', {enabled})
    , getBluetoothStatus: () => sendTwoWay('bluetooth.get')
    , cleanBluetoothBondedDevices: () => sendTwoWay('bluetooth.cleanBonds')
  }
}

export type Control = ReturnType<typeof createControl>
