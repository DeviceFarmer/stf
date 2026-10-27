/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import deviceData from '@devicefarmer/stf-device-db'
import browserData from './browsers.js'

import deviceutil from './deviceutil.js'
import {findCatalogDevice} from './device-catalog.js'
import {fallbackDeviceImage} from './device-image-paths.js'
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
  platform?: string | null
  manufacturer?: string | null
  marketName?: string | null
  name?: string
  releasedAt?: string | null
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

function applyDisplayInches(display?: DisplayView) {
  if (!display) {
    return
  }
  if (typeof display.inches === 'number' && Number.isFinite(display.inches) && display.inches > 0) {
    return
  }
  if (typeof display.size === 'number' && Number.isFinite(display.size) && display.size > 0) {
    display.inches = Math.round(display.size * 100) / 100
    return
  }
  if (typeof display.width === 'number' && display.width > 0 &&
      typeof display.height === 'number' && display.height > 0 &&
      typeof display.xdpi === 'number' && display.xdpi > 0 &&
      typeof display.ydpi === 'number' && display.ydpi > 0) {
    var diag = Math.hypot(display.width / display.xdpi, display.height / display.ydpi)
    if (diag >= 0.8 && diag <= 30) {
      display.inches = Math.round(diag * 100) / 100
    }
  }
}

datautil.applyData = function<D extends DeviceView>(device: D) {
  applyDisplayInches(device.display)

  var local = findCatalogDevice(device)
  if (local) {
    device.name = local.name
    device.image = local.image
  }

  var match = deviceData.find({
    model: device.model
  , name: device.product
  , manufacturer: device.manufacturer
  , platform: device.platform
  })

  if (match) {
    if (!local) {
      device.name = match.name.id
    }
    if (match.marketName && !device.marketName) {
      device.marketName = match.marketName
    }
    if (match.date && !device.releasedAt) {
      device.releasedAt = match.date
    }
    if (!device.image && match.image) {
      device.image = match.image
    }
    if (match.cpu) {
      if (!device.cpu) {
        device.cpu = match.cpu
      }
      else {
        if (device.cpu.name === null && match.cpu.name !== null) {
          device.cpu.name = match.cpu.name
        }
        if (device.cpu.cores === null && match.cpu.cores !== null) {
          device.cpu.cores = match.cpu.cores
        }
        if (device.cpu.freq === null && match.cpu.freq !== null) {
          device.cpu.freq = match.cpu.freq
        }
      }
    }
    if (match.memory) {
      if (!device.memory) {
        device.memory = match.memory
      }
      else {
        if (device.memory.ram === null && match.memory.ram !== null) {
          device.memory.ram = match.memory.ram
        }
        if (device.memory.rom === null && match.memory.rom !== null) {
          device.memory.rom = match.memory.rom
        }
      }
    }
  }
  else if (local && !device.marketName) {
    device.marketName = local.name
  }

  if (!device.image) {
    device.image = fallbackDeviceImage
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
