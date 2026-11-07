import type {DeviceDisplayMessageFields} from '../types/wire.js'

export function computeDisplaySize(
  width: number
, height: number
, xdpi: number
, ydpi: number
): number {
  if (
    Number.isFinite(width) && width > 0 &&
    Number.isFinite(height) && height > 0 &&
    Number.isFinite(xdpi) && xdpi > 0 &&
    Number.isFinite(ydpi) && ydpi > 0
  ) {
    const diag = Math.hypot(width / xdpi, height / ydpi)
    if (Number.isFinite(diag)) {
      return diag
    }
  }
  return 0
}

export function cleanDisplay<T extends Partial<DeviceDisplayMessageFields>>(
  display?: T
): T | undefined {
  if (!display) {
    return display
  }
  const clean = Object.assign({}, display)
  const numericKeys = [
    'size'
  , 'xdpi'
  , 'ydpi'
  , 'fps'
  , 'density'
  , 'width'
  , 'height'
  , 'rotation'
  , 'id'
  ] as const
  for (const key of numericKeys) {
    const val = clean[key]
    if (typeof val === 'number' && !Number.isFinite(val)) {
      clean[key] = 0
    }
  }
  return clean
}
