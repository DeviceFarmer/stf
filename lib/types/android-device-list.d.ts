declare module 'android-device-list' {
  interface AndroidDevice {
    brand: string
    name: string
    device: string
    model: string
  }

  interface SearchOptions {
    caseInsensitive?: boolean
    contains?: boolean
  }

  export function getDevicesByDeviceId(deviceId: string, options?: SearchOptions): AndroidDevice[]
}
