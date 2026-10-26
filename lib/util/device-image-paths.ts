export const fallbackDeviceImage = 'generic-phone-v1.svg'

export interface DeviceImageMetadata {
  display?: {
    width?: number | null | undefined
    height?: number | null | undefined
    xdpi?: number | null | undefined
    ydpi?: number | null | undefined
  } | null | undefined
  sdk?: string | number | null | undefined
  platform?: string | null | undefined
  manufacturer?: string | null | undefined
  marketName?: string | null | undefined
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function encodeImageSegment(segment: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(segment))
  }
  catch {
    return encodeURIComponent(segment)
  }
}

export function deviceImageUrl(
  image: string | null | undefined
, size: 'icon/x24' | 'icon/x120' | 'photo/x800'
, device?: DeviceImageMetadata | null
): string {
  const rawImage = image && image.trim() ? image.trim() : fallbackDeviceImage
  const queryIndex = rawImage.indexOf('?')
  const imagePath = queryIndex === -1 ? rawImage : rawImage.slice(0, queryIndex)
  const params = new URLSearchParams(queryIndex === -1 ? '' : rawImage.slice(queryIndex + 1))

  if (device) {
    const display = device.display
    if (display) {
      if (isPositiveFinite(display.width)) {
        params.set('w', String(display.width))
      }
      if (isPositiveFinite(display.height)) {
        params.set('h', String(display.height))
      }
      if (isPositiveFinite(display.xdpi)) {
        params.set('xd', String(display.xdpi))
      }
      if (isPositiveFinite(display.ydpi)) {
        params.set('yd', String(display.ydpi))
      }
    }
    const isIos = typeof device.platform === 'string' &&
      device.platform.trim().toLowerCase() === 'ios'
    if (!isIos) {
      if (isPositiveFinite(device.sdk)) {
        params.set('sdk', String(device.sdk))
      }
      else if (typeof device.sdk === 'string' && device.sdk.trim() !== '' &&
               device.sdk.trim().toLowerCase() !== 'unknown') {
        params.set('sdk', device.sdk.trim())
      }
    }
    if (typeof device.manufacturer === 'string' && device.manufacturer.trim() !== '') {
      params.set('b', device.manufacturer.trim())
    }
    if (typeof device.marketName === 'string' && device.marketName.trim() !== '') {
      params.set('m', device.marketName.trim())
    }
  }

  const baseUrl = '/static/app/devices/' + size + '/' + encodeImageSegment(imagePath)
  const query = params.toString()
  return query ? baseUrl + '?' + query : baseUrl
}
