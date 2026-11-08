import type {DeviceDisplayMessageFields} from '../types/wire.js'

export function computeDisplaySize(
  width: number
, height: number
, xdpi: number
, ydpi: number
): number | undefined {
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
  // Unknown (e.g. headless displays reporting 0 dpi): leave the size out
  // rather than inventing a value, exactly like devices that never reported one.
  return undefined
}

export function cleanDisplay<T extends Partial<DeviceDisplayMessageFields>>(
  display?: T
): T | undefined {
  if (!display) {
    return display
  }
  const clean = Object.assign({}, display)
  if (typeof clean.size === 'number' && !Number.isFinite(clean.size)) {
    delete clean.size
  }
  const numericKeys = [
    'xdpi'
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
