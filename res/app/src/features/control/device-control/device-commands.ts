import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {translate} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'

export function rotationOf(device: Device): number {
  return device.display ? device.display.rotation : 0
}

export function rotateBy(control: Control, rotation: number, delta: number, standalone: boolean) {
  control.rotate((rotation + delta + 360) % 360)
  if (standalone) {
    window.resizeTo(window.outerHeight, window.outerWidth)
  }
}

export function saveScreenshot(control: Control) {
  control.screenshot()
    .then((result) => {
      window.location.href = `${result.body.href}?download`
    })
    .catch((error) => {
      notifyFailure(error, translate('Save ScreenShot'))
    })
}
