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
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(value)
}
