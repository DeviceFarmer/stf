/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import deviceData from '@devicefarmer/stf-device-db'
import browserData from '@devicefarmer/stf-browser-db'

import deviceutil from './deviceutil.js'
import type {DeviceDisplayMessageFields} from '../types/wire.js'

interface DisplayView extends Partial<DeviceDisplayMessageFields> {
  inches?: number
}

interface BrowserView {
  apps: Array<{type: string, developer?: string}>
}

interface DeviceView extends deviceutil.Claimable {
  present?: boolean
  using?: boolean
  claimed?: boolean
  model?: string | null
  product?: string | null
  name?: string
  releasedAt?: string
  image?: string
  cpu?: deviceData.DeviceData['cpu']
  memory?: deviceData.DeviceData['memory']
  display?: DisplayView
  browser?: BrowserView | null
  remoteConnect?: boolean
  remoteConnectUrl?: string | null
}

interface DataUtil {
  applyData<D extends DeviceView>(device: D): D
  applyBrowsers<D extends DeviceView>(device: D): D
  applyOwner<D extends DeviceView>(device: D, user: deviceutil.Viewer): D
  applyOwnerOnlyInfo(device: DeviceView, user: deviceutil.Viewer): void
  normalize(device: DeviceView, user: deviceutil.Viewer): void
}

var datautil: DataUtil = Object.create(null)

datautil.applyData = function<D extends DeviceView>(device: D) {
  var match = deviceData.find({
    model: device.model
  , name: device.product
  })

  if (match) {
    device.name = match.name.id
    device.releasedAt = match.date
    device.image = match.image
    device.cpu = match.cpu
    device.memory = match.memory
    if (match.display && match.display.s) {
      device.display = device.display || {}
      device.display.inches = match.display.s
    }
  }

  return device
}

datautil.applyBrowsers = function<D extends DeviceView>(device: D) {
  if (device.browser) {
    device.browser.apps.forEach(function(app) {
      var data = browserData[app.type]
      if (data) {
        app.developer = data.developer
      }
    })
  }
  return device
}

datautil.applyOwner = function<D extends DeviceView>(device: D, user: deviceutil.Viewer) {
  device.using = !!device.owner &&
                 (device.owner.email === user.email || user.privilege === 'admin')
  return device
}

// Only owner can see this information
datautil.applyOwnerOnlyInfo = function(device: DeviceView, user: deviceutil.Viewer) {
  if (device.owner && (device.owner.email === user.email || user.privilege === 'admin')) {
    // No-op
  }
  else {
    device.remoteConnect = false
    device.remoteConnectUrl = null
  }
}

datautil.normalize = function(device: DeviceView, user: deviceutil.Viewer) {
  datautil.applyData(device)
  datautil.applyBrowsers(device)
  datautil.applyOwner(device, user)
  datautil.applyOwnerOnlyInfo(device, user)
  if (!device.present) {
    device.owner = null
  }
  // Whether a device is being held is worth knowing; who it is being held for is not anyone
  // else's business, so the name does not leave the server. An expired claim holds nothing, so it
  // must not read as held here either: this is the only place the expiry is judged for readers.
  device.claimed = deviceutil.isClaimLive(device, Date.now())
  delete device.restoreOwner
}

namespace datautil {
  export type Device = DeviceView
}

export default datautil
