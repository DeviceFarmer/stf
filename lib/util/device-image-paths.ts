export const fallbackDeviceImage = 'generic-phone-v1.svg'

export function deviceImageUrl(
  image: string | null | undefined, size: 'icon/x24' | 'icon/x120' | 'photo/x800'
): string {
  return '/static/app/devices/' + size + '/' + (image || fallbackDeviceImage)
}
