import type {Device} from '@/core/devices/types'
import {kickDevice} from '@/core/group'
import {scalingCoordinator} from '@/core/scaling'
import {getSetting, setSetting} from '@/core/settings'

interface WindowGeometry {
  width: number
  height: number
  top: number
  left: number
}

const geometrySetting = 'standaloneWindowGeometry'
const windowSizeRatio = 0.5
const sizeTolerance = 1

function deviceDisplay(device: Device) {
  return device.display || {width: 1080, height: 1920, rotation: 0}
}

function fitDeviceInBounds(device: Device, width: number, height: number, rotation: number) {
  const display = deviceDisplay(device)
  return scalingCoordinator(display.width, display.height).projectedSize(width, height, rotation)
}

function defaultGeometry(device: Device): WindowGeometry {
  const screenWidth = window.screen.availWidth || window.screen.width || 1024
  const screenHeight = window.screen.availHeight || window.screen.height || 768
  const projected = fitDeviceInBounds(
    device
    , screenWidth * windowSizeRatio
    , screenHeight * windowSizeRatio
    , deviceDisplay(device).rotation
  )
  return {
    width: projected.width
    , height: projected.height
    , top: screenHeight / 4
    , left: screenWidth / 5
  }
}

function savedGeometry(device: Device): WindowGeometry | undefined {
  return getSetting<Record<string, WindowGeometry> | undefined>(geometrySetting)?.[device.serial]
}

function windowTitle(device: Device): string {
  return device.enhancedName === device.model ?
    `STF - ${device.enhancedName}` :
    `STF - ${device.enhancedName} (${device.model})`
}

export function openStandalone(device: Device): Window | null {
  const geometry = savedGeometry(device) || defaultGeometry(device)
  const features = [
    `width=${geometry.width}`
    , `height=${geometry.height}`
    , `top=${geometry.top}`
    , `left=${geometry.left}`
    , 'toolbar=no'
    , 'location=no'
    , 'dialog=yes'
    , 'personalbar=no'
    , 'directories=no'
    , 'status=no'
    , 'menubar=no'
    , 'scrollbars=no'
    , 'copyhistory=no'
    , 'resizable=yes'
  ].join(',')

  const popup = window.open(`#/c/${device.serial}?standalone`, `STF-${device.serial}`, features)
  if (!popup) {
    return null
  }

  const title = windowTitle(device)
  popup.document.title = title
  setTimeout(() => {
    popup.document.title = title
  }, 400)

  popup.onbeforeunload = () => {
    kickDevice(device).catch(() => undefined)
    setSetting(geometrySetting, {
      [device.serial]: {
        width: popup.innerWidth
        , height: popup.innerHeight
        , top: popup.screenTop
        , left: popup.screenLeft
      }
    })
  }

  popup.onresize = () => {
    const fitted = fitDeviceInBounds(device, popup.outerWidth, popup.outerHeight, 0)
    if (Math.abs(fitted.width - popup.outerWidth) > sizeTolerance ||
        Math.abs(fitted.height - popup.outerHeight) > sizeTolerance) {
      popup.resizeTo(fitted.width, fitted.height)
    }
  }

  return popup
}
