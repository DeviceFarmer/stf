export interface DeviceAccess {
  serial: string
  platform?: string
  channel?: string
  present?: boolean
  ready?: boolean
  usage?: string | null
  group?: {id?: string | null}
  owner?: {email?: string, group?: string, reservationId?: string | null} | null
}

export type LoadDevice = (serial: string) => PromiseLike<DeviceAccess | null | undefined>

export function isValidSerial(value: unknown): value is string {
  // ADB also identifies devices by host:port, IPv6 and wireless discovery names.
  return typeof value === 'string' && /^[A-Za-z0-9_.:[\]-]{1,128}$/.test(value)
}
