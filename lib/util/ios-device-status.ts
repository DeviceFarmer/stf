export interface IosDeviceStatus {
  phase: string
  reason: string
  attempts: number
  lastReadyAt: string | null
  updatedAt: string
  name: string | null
  locked: boolean | null
  battery: {level: number, charging: boolean, externalPower: boolean, full: boolean} | null
  storage: {total: number, free: number} | null
  telemetryAt: string | null
  wda: {
    installed: boolean | null
    bundleId: string
    version: string | null
    profile: 'valid' | 'expiring' | 'expired' | 'missing' | 'unknown' | 'ambiguous'
    expiresAt: string | null
    checkedAt: string | null
  }
}

// Use the existing property message without changing Android's wire fields.
export function decodeIosDeviceStatus(input: unknown): IosDeviceStatus | null {
  try {
    if (typeof input !== 'string' || input.length > 8192) {
      return null
    }
    const value = JSON.parse(input) as IosDeviceStatus
    const date = (v: unknown) => v === null ||
      (typeof v === 'string' && Number.isFinite(Date.parse(v)))
    const boolean = (v: unknown) => v === null || typeof v === 'boolean'
    const battery = value?.battery
    const storage = value?.storage
    if (!value || typeof value.phase !== 'string' || typeof value.reason !== 'string' ||
        !value.wda || typeof value.wda.bundleId !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,255}$/.test(value.wda.bundleId) ||
        !/^[a-z_]{1,80}$/.test(value.phase) || !/^[a-z_]{1,80}$/.test(value.reason) ||
        typeof value.updatedAt !== 'string' || !date(value.updatedAt) ||
        !Number.isInteger(value.attempts) || value.attempts < 0 ||
        !(value.name === null || (typeof value.name === 'string' && value.name.length <= 255)) ||
        !date(value.lastReadyAt) || !date(value.telemetryAt) || !boolean(value.locked) ||
        !boolean(value.wda.installed) || !date(value.wda.expiresAt) || !date(value.wda.checkedAt) ||
        !(value.wda.version === null || typeof value.wda.version === 'string') ||
        !['valid', 'expiring', 'expired', 'missing', 'unknown', 'ambiguous']
          .includes(value.wda.profile) ||
        (battery !== null && (!battery || !Number.isFinite(battery.level) ||
          battery.level < 0 || battery.level > 100 || typeof battery.charging !== 'boolean' ||
          typeof battery.externalPower !== 'boolean' || typeof battery.full !== 'boolean')) ||
        (storage !== null && (!storage || !Number.isFinite(storage.total) ||
          !Number.isFinite(storage.free) || storage.total <= 0 || storage.free < 0 ||
          storage.free > storage.total))) {
      return null
    }
    return {phase: value.phase, reason: value.reason, attempts: value.attempts
      , lastReadyAt: value.lastReadyAt, updatedAt: value.updatedAt, name: value.name
      , locked: value.locked, telemetryAt: value.telemetryAt
      , battery: battery && {level: battery.level, charging: battery.charging
        , externalPower: battery.externalPower, full: battery.full}
      , storage: storage && {total: storage.total, free: storage.free}
      , wda: {installed: value.wda.installed, bundleId: value.wda.bundleId
        , version: value.wda.version, profile: value.wda.profile
        , expiresAt: value.wda.expiresAt, checkedAt: value.wda.checkedAt}}
  }
  catch {
    return null
  }
}

export function readIosProperties(properties: Array<{name: string, value: string}>) {
  return decodeIosDeviceStatus(properties.find(p => p.name === 'stf.ios.status')?.value)
}
