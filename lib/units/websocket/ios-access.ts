interface DeviceAccess {
  serial: string
  platform?: string
  channel?: string
  present?: boolean
  ready?: boolean
  usage?: string | null
  group?: {id?: string}
  owner?: {email?: string} | null
}

interface IosUser {
  email: string
  privilege?: string
  groups: {subscribed: string[]}
}

export type LoadDevice = (serial: string) => PromiseLike<DeviceAccess | null | undefined>

interface DevicePacketPolicy {
  matches: (event: unknown) => boolean
  allows: (channel: unknown, groups: string[], load: LoadDevice) => PromiseLike<boolean>
  source: (channel: string) => string
}

interface AccessFailure {
  source: string
  seq: number
  success: false
  data: string
}

export async function allowIosPacket(
  event: string
, channel: unknown
, user: IosUser
, load: LoadDevice
): Promise<boolean> {
  if (typeof channel !== 'string' || !channel.startsWith('ios:')) {
    return true
  }
  const serial = channel.slice(4)
  if (!/^[A-Za-z0-9-]{1,128}$/.test(serial)) {
    return false
  }
  const device = await load(serial)
  if (!device || device.platform !== 'iOS' || device.channel !== channel ||
      !device.present || !device.ready || !device.group?.id ||
      !user.groups.subscribed.includes(device.group.id)) {
    return false
  }
  return user.privilege === 'admin' || device.owner?.email === user.email ||
    (event === 'group.invite' && !device.owner)
}

export function createDevicePacketGuard(
  user: IosUser
, load: LoadDevice
, cancel: (channel: string, failure: AccessFailure) => void
, devicePolicy?: DevicePacketPolicy
) {
  let queue = Promise.resolve()
  return (packet: readonly unknown[], next: (error?: Error) => void) => {
    const [event, channel, responseChannel] = packet
    const checkDevice = devicePolicy?.matches(event) || false
    const ios = typeof channel === 'string' && channel.startsWith('ios:')
    if (!ios && !checkDevice) {
      next()
      return
    }
    const operation = queue.then(async() => {
      let reason: string | null = null
      // Share one fresh snapshot across automation and iOS ownership checks.
      const devices = new Map<string, Promise<DeviceAccess | null | undefined>>()
      const loadOnce: LoadDevice = serial => {
        if (!devices.has(serial)) {
          devices.set(serial, Promise.resolve().then(() => load(serial)))
        }
        return devices.get(serial)!
      }
      try {
        if (typeof event !== 'string' || typeof channel !== 'string' ||
            (checkDevice && !await devicePolicy!.allows(
              channel, user.groups.subscribed, loadOnce)) ||
            !await allowIosPacket(event, channel, user, loadOnce)) {
          reason = 'Device access denied'
        }
      }
      catch {
        reason = 'Device access unavailable'
      }
      if (reason) {
        if (typeof responseChannel === 'string' &&
            /^tx\.[\w.-]{1,128}$/.test(responseChannel)) {
          const source = typeof channel === 'string' ?
            devicePolicy?.source(channel) || channel.slice(4) : ''
          cancel(responseChannel, {source
          , seq: 0, success: false, data: reason})
        }
        return next(new Error(reason))
      }
      else {
        return next()
      }
    })
    // Authorization and delivery must preserve the order of touch events.
    queue = operation.catch(() => {})
  }
}
