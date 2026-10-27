import type {Device} from '@/core/devices/types'
import {releaseDevice} from '@/core/group'
import {loadDevice} from '@/core/devices/store'
import {currentUser} from '@/core/user'
import {standaloneSessionType, type StandaloneSession} from './standalone-session'
import {isAutomated} from '@/core/devices/enhance'
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
type StopSession = () => void
const windowSessions = new Map<Window, StopSession>()

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

  const watching = isAutomated(device)
  const mode = watching ? '&mode=watch' : ''
  const popup = window.open(`#/c/${device.serial}?standalone${mode}`, `STF-${device.serial}`, features)
  if (!popup) {
    return null
  }

  const title = windowTitle(device)
  popup.document.title = title
  setTimeout(() => {
    if (!popup.closed) {
      popup.document.title = title
    }
  }, 400)

  // The opener survives the popup's teardown. Reloading a popup is not the
  // same as closing it, and ownership must be confirmed by this popup first.
  windowSessions.get(popup)?.()
  let manual: StandaloneSession | null = null
  const onSession = (event: MessageEvent<StandaloneSession>) => {
    const session = event.data
    if (event.source !== popup || event.origin !== window.location.origin ||
        !session || session.type !== standaloneSessionType || session.serial !== device.serial) {
      return
    }
    manual = session.manual && session.ownerEmail === currentUser.email &&
      typeof session.channel === 'string' && Boolean(session.channel) &&
      typeof session.reservationId === 'string' && Boolean(session.reservationId) ? session : null
  }
  window.addEventListener('message', onSession)
  const timer = setInterval(() => {
    if (!popup.closed) {
      return
    }
    const session = manual
    cleanup()
    if (session) {
      releaseClosedSession(session).catch(() => undefined)
    }
  }, 250)
  async function releaseClosedSession(session: StandaloneSession) {
    // An acknowledged join can precede the processor's owner write. Retry
    // only the empty snapshot; a different lease or runtime ends cleanup.
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await loadDevice(device.serial)
      if (current.channel !== session.channel || !current.present || !current.ready) {
        return
      }
      if (current.owner) {
        if (!isAutomated(current) && current.owner.email === currentUser.email &&
            current.owner.email === session.ownerEmail && current.owner.reservationId === session.reservationId) {
          await releaseDevice(current)
        }
        return
      }
      if (attempt < 9) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }
  function cleanup() {
    clearInterval(timer)
    window.removeEventListener('message', onSession)
    windowSessions.delete(popup!)
  }
  windowSessions.set(popup, cleanup)

  popup.onbeforeunload = () => {
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
