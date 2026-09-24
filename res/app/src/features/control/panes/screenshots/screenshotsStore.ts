import {create} from 'zustand'
import {createDeviceStore} from '@/core/device-store'

export interface Screenshot {
  id: string
  href: string
  date: string
}

export const minShotSize = 80
export const maxShotSize = 480
export const shotSizeStep = 10
export const zoomStep = 50

export const screenshotsStore = createDeviceStore<Screenshot[]>([])

export function addScreenshot(serial: string, shot: Screenshot) {
  screenshotsStore.update(serial, (shots) => [shot, ...shots])
}

export function clearScreenshots(serial: string) {
  screenshotsStore.set(serial, [])
}

interface ScreenshotSizeState {
  size: number
  setSize: (size: number) => void
}

export const useScreenshotSize = create<ScreenshotSizeState>((set) => ({
  size: 400
  , setSize: (size) => set({size: Math.min(Math.max(size, minShotSize), maxShotSize)})
}))

export function shotSizeParameter(size: number, multiplier: number): string {
  const finalSize = size * multiplier
  return finalSize === maxShotSize * multiplier ? '' : `?crop=${finalSize}x`
}
