declare module '@devicefarmer/stf-device-db' {
  interface DeviceProperties {
    model?: string | null | undefined
    name?: string | null | undefined
  }

  interface DeviceData {
    carrier?: {
      code: string
      name: string
    }
    cpu: {
      cores: number
      freq: number
      name: string
    }
    date: string
    display: {
      h: number
      s: number
      w: number
    }
    maker: {
      code?: string
      name: string
    }
    memory: {
      ram: number
      rom: number
    }
    name: {
      id: string
      long?: string
      product?: string
    }
    os: {
      type?: string
      ver: string
    }
    flags?: {
      forceMaxPressure?: number
      forceTouchMode?: string
      forceMinScreenScale?: number
      forceTouchOrigin?: string
    }
    image: string
  }

  export function find(properties: DeviceProperties): DeviceData | null
}
