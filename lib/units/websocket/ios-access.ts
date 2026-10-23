interface DeviceAccess {
  serial: string
  platform?: string
  channel?: string
  present?: boolean
  ready?: boolean
  group?: {id?: string}
  owner?: {email?: string} | null
}

interface IosUser {
  email: string
  privilege?: string
  groups: {subscribed: string[]}
}

type LoadDevice = (serial: string) => PromiseLike<DeviceAccess | null | undefined>

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

export function createIosPacketGuard(
  user: IosUser
, load: LoadDevice
, cancel: (channel: string, failure: AccessFailure) => void
) {
  let queue = Promise.resolve()
  return (packet: readonly unknown[], next: (error?: Error) => void) => {
    const [event, channel, responseChannel] = packet
    if (typeof channel !== 'string' || !channel.startsWith('ios:')) {
      next()
      return
    }
    const operation = queue.then(async() => {
      let reason: string | null = null
      try {
        if (typeof event !== 'string' || !await allowIosPacket(event, channel, user, load)) {
          reason = 'Device access denied'
        }
      }
      catch {
        reason = 'Device access unavailable'
      }
      if (reason) {
        if (typeof responseChannel === 'string' && /^tx\.[\w.-]{1,128}$/.test(responseChannel)) {
          cancel(responseChannel, {source: channel.slice(4), seq: 0, success: false, data: reason})
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
