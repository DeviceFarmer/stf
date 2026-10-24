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
  checkpoint?: () => number
  current?: (channel: string, checkpoint: number) => boolean
}

interface PacketGuardOptions {
  lookupTimeoutMs?: number
  maxPendingPackets?: number
  maxChannels?: number
  disconnect?: () => void
}

interface PendingPacket {
  packet: readonly unknown[]
  next: (error?: Error) => void
  done: boolean
}

interface PacketQueue {
  pending: PendingPacket[]
  active: PendingPacket[]
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
, options: PacketGuardOptions = {}
) {
  const queues = new Map<string, PacketQueue>()
  const timeoutMs = options.lookupTimeoutMs ?? 2000
  const maxPending = options.maxPendingPackets ?? 256
  const maxChannels = options.maxChannels ?? 16
  let pendingCount = 0
  let closed = false

  function finish(entry: PendingPacket, reason?: string | null) {
    if (entry.done) {
      return
    }
    entry.done = true
    pendingCount--
    const [, channel, responseChannel] = entry.packet
    if (reason && typeof responseChannel === 'string' &&
        /^tx\.[\w.-]{1,128}$/.test(responseChannel)) {
      const source = typeof channel === 'string' ?
        devicePolicy?.source(channel) || channel.slice(4) : ''
      cancel(responseChannel, {source, seq: 0, success: false, data: reason})
    }
    if (reason) {
      entry.next(new Error(reason))
    }
    else {
      entry.next()
    }
  }

  function failClosed(reason: string) {
    closed = true
    for (const queue of queues.values()) {
      for (const entry of [...queue.active, ...queue.pending]) {
        finish(entry, reason)
      }
    }
    queues.clear()
    // A broken gesture must not continue with its tail missing.
    options.disconnect?.()
  }

  async function drain(channel: string, queue: PacketQueue) {
    while (queue.pending.length && !closed) {
      const checkpoint = devicePolicy?.checkpoint?.()
      const current = () => typeof checkpoint === 'undefined' ||
        !devicePolicy?.current || devicePolicy.current(channel, checkpoint)
      // Only packets waiting on this lookup share its snapshot. Nothing is
      // cached between batches, including a previously successful permission.
      const devices = new Map<string, Promise<DeviceAccess | null | undefined>>()
      const loadOnce: LoadDevice = serial => {
        if (!devices.has(serial)) {
          devices.set(serial, Promise.resolve().then(() => load(serial)))
        }
        return devices.get(serial)!
      }
      const authorize = async(entry: PendingPacket): Promise<string | null> => {
        const [event] = entry.packet
        try {
          if (!current() || typeof event !== 'string' ||
              (devicePolicy?.matches(event) && !await devicePolicy.allows(
                channel, user.groups.subscribed, loadOnce)) ||
              !await allowIosPacket(event, channel, user, loadOnce) || !current()) {
            return 'Device access denied'
          }
        }
        catch {
          return 'Device access unavailable'
        }
        return null
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      })
      const first = await Promise.race([authorize(queue.pending[0]!), deadline])
      if (closed) {
        clearTimeout(timer)
        return
      }
      if (first === 'timeout') {
        clearTimeout(timer)
        failClosed('Device access lookup timed out')
        return
      }
      queue.active = queue.pending.splice(0)
      for (const [index, entry] of queue.active.entries()) {
        if (closed) {
          clearTimeout(timer)
          return
        }
        // Recheck notification state at delivery, including join then release
        // while an old snapshot was in flight. Preserve every touch packet.
        const reason = index === 0 ? first :
          await Promise.race([authorize(entry), deadline])
        if (reason === 'timeout') {
          clearTimeout(timer)
          failClosed('Device access lookup timed out')
          return
        }
        finish(entry, current() ? reason : 'Device access denied')
      }
      clearTimeout(timer)
      queue.active = []
    }
    queues.delete(channel)
  }

  return (packet: readonly unknown[], next: (error?: Error) => void) => {
    const [event, channel] = packet
    const checkDevice = devicePolicy?.matches(event) || false
    const ios = typeof channel === 'string' && channel.startsWith('ios:')
    if (!ios && !checkDevice) {
      next()
      return
    }
    const entry = {packet, next, done: false}
    pendingCount++
    if (closed || typeof channel !== 'string') {
      finish(entry, 'Device access denied')
      return
    }
    let queue = queues.get(channel)
    if (pendingCount > maxPending || (!queue && queues.size >= maxChannels)) {
      finish(entry, 'Device access queue limit exceeded')
      failClosed('Device access queue limit exceeded')
      return
    }
    if (queue) {
      queue.pending.push(entry)
    }
    else {
      queue = {pending: [entry], active: []}
      queues.set(channel, queue)
      drain(channel, queue).catch(() => failClosed('Device access unavailable'))
    }
  }
}
