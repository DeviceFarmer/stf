import {randomUUID} from 'node:crypto'
import {isValidSerial} from './access.js'
import deviceutil from '../../util/deviceutil.js'
import type {DeviceAccess, LoadDevice} from './access.js'

/** Why an invite was refused; the web UI matches it to explain the refusal. */
export const CLAIMED_FOR_OTHER = 'Device is kept for its previous user'

interface IosUser {
  email: string
  privilege?: string
  groups: {subscribed: string[]}
}

interface DevicePacketPolicy {
  matches: (event: unknown) => boolean
  // Commands only the device's owner or an admin may send; input always needs the owner.
  requiresOwner?: (event: unknown) => boolean
  allows: (channel: unknown, groups: string[], load: LoadDevice) => PromiseLike<boolean>
  source: (channel: string) => string
  snapshot?: (device: DeviceAccess) => DeviceAccess
  session?: (channel: string) => number
  checkpoint?: () => number
  current?: (channel: string, checkpoint: number) => boolean
  awaitingJoin?: (channel: string, email: string, groups: string[]) => boolean
}

export interface AuthorizedInput {
  gestureId: string | null
  reservationId: string | null
  screenSessionId?: string
}

interface PacketGuardOptions {
  lookupTimeoutMs?: number
  maxPendingPackets?: number
  maxTotalPendingPackets?: number
  maxChannels?: number
  inputCacheMs?: number
  persistRetryMs?: number
  persistWaitMs?: number
  resetGesture?: (channel: string, identity?: AuthorizedInput) => void
  onAuthorizedInput?: (packet: readonly unknown[], identity: AuthorizedInput) => void
  onAuthorizedRotation?: (data: unknown, reservationId: string | null) => void
}

interface PendingPacket {
  packet: readonly unknown[]
  next: (error?: Error) => void
  deadline: number
  done: boolean
}

interface PacketQueue {
  pending: PendingPacket[]
  failed: boolean
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
  if (!isValidSerial(serial)) {
    return false
  }
  const device = await load(serial)
  if (!device || device.platform !== 'iOS' || device.channel !== channel ||
      !device.present || !device.ready || !device.group?.id ||
      !user.groups.subscribed.includes(device.group.id) || device.usage === 'automation' ||
      device.automationLeaseId) {
    return false
  }
  return user.privilege === 'admin' || device.owner?.email === user.email ||
    (event === 'group.invite' && !device.owner)
}

/** Orders each device independently; permission notifications invalidate input snapshots. */
export function createDevicePacketGuard(
  user: IosUser
, load: LoadDevice
, cancel: (channel: string, failure: AccessFailure) => void
, devicePolicy?: DevicePacketPolicy
, options: PacketGuardOptions = {}
) {
  const queues = new Map<string, PacketQueue>()
  const inputPermissions = new Map<string, {checkpoint: number, until: number
    , groups: string, identity: string, reservationId: string | null}>()
  const gestures = new Map<string, {identity: string, scope: AuthorizedInput}>()
  const gestureSource = randomUUID()
  let gestureCounter = 0
  const timeoutMs = options.lookupTimeoutMs ?? 2000
  const maxPending = options.maxPendingPackets ?? 256
  const maxTotalPending = options.maxTotalPendingPackets ?? 4096
  const maxChannels = options.maxChannels ?? 16
  const cacheMs = Math.min(1000, Math.max(0, options.inputCacheMs ?? 100))
  const persistRetryMs = Math.max(1, options.persistRetryMs ?? 20)
  const persistWaitMs = Math.max(0, options.persistWaitMs ?? 1000)
  let pendingCount = 0

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
    entry.next(reason ? new Error(reason) : undefined)
  }

  function failChannel(channel: string, queue: PacketQueue, reason: string) {
    queue.failed = true
    inputPermissions.delete(channel)
    // A scoped provider reset cannot affect a newer gesture or another owner.
    options.resetGesture?.(channel, gestures.get(channel)?.scope)
    gestures.delete(channel)
    for (const entry of queue.pending.splice(0)) {
      finish(entry, reason)
    }
    if (queues.get(channel) === queue) {
      queues.delete(channel)
    }
  }

  async function drain(channel: string, queue: PacketQueue) {
    let checkpoint: number | undefined, commandClass: string | undefined
    let snapshots = new Map<string, Promise<DeviceAccess | null | undefined>>()
    let snapshotExpires = 0
    let identity = ''
    let joinWait = null as {entry: PendingPacket, start: number, retries: number} | null
    let reservationId: string | null = null
    const current = (value: number | undefined) => typeof value === 'undefined' ||
      !devicePolicy?.current || devicePolicy.current(channel, value)
    const loadOnce: LoadDevice = serial => {
      if (!snapshots.has(serial)) {
        snapshots.set(serial, Promise.resolve().then(() => load(serial)).then(loaded => {
          const device = loaded && devicePolicy?.snapshot ?
              devicePolicy.snapshot(loaded) : loaded
          if (device) {
            reservationId = device.owner?.reservationId || null
            identity = JSON.stringify([device.serial, device.channel, device.group?.id
              , device.owner?.email, device.owner?.reservationId || device.owner?.group
              , devicePolicy?.session?.(channel)])
          }
          return device
        }))
      }
      return snapshots.get(serial)!
    }
    while (queue.pending.length && !queue.failed) {
      const entry = queue.pending[0]!
      const event = entry.packet[0]
      if (typeof event !== 'string' || (!gestures.has(channel) &&
          (event.startsWith('input.touch') || event === 'input.gestureStop') &&
          event !== 'input.touchReset')) {
        failChannel(channel, queue, 'Device access denied')
        return
      }
      const input = event.startsWith('input.')
      const nextClass = input ? 'input' : event
      const subscribed = JSON.stringify(user.groups.subscribed)
      const cached = input ? inputPermissions.get(channel) : undefined
      let reason: string | null = null
      let validatedAt = checkpoint
      if (cached && cached.until > Date.now() && cached.groups === subscribed &&
          current(cached.checkpoint)) {
        validatedAt = cached.checkpoint
        identity = cached.identity
        reservationId = cached.reservationId
      }
      else {
        if (commandClass !== nextClass || !current(checkpoint) || snapshotExpires <= Date.now()) {
          snapshots = new Map()
          checkpoint = devicePolicy?.checkpoint?.()
          commandClass = nextClass
          snapshotExpires = Infinity
        }
        validatedAt = checkpoint
        const authorize = async(): Promise<string | null> => {
          try {
            if ((devicePolicy?.matches(event) && !await devicePolicy.allows(
              channel, user.groups.subscribed, loadOnce)) ||
                !await allowIosPacket(event, channel, user, loadOnce)) {
              return 'Device access denied'
            }
            if (event === 'group.invite') {
              // Nobody but the user it is kept for may take a device that is coming back from a
              // reboot, not even an administrator; the API and the coordinator refuse it too.
              const serial = devicePolicy?.source(channel) ||
                (channel.startsWith('ios:') ? channel.slice(4) : channel)
              if (deviceutil.isClaimedForOther(await loadOnce(serial), user.email, Date.now())) {
                return CLAIMED_FOR_OTHER
              }
            }
            if (input || devicePolicy?.requiresOwner?.(event)) {
              const serial = devicePolicy?.source(channel) ||
                (channel.startsWith('ios:') ? channel.slice(4) : channel)
              const device = await loadOnce(serial)
              const admin = user.privilege === 'admin'
              // Admin input still needs a manual owner to stamp the gesture with.
              if (input ? !device?.owner || (device.owner.email !== user.email && !admin) :
                !admin && device?.owner?.email !== user.email) {
                return 'Device access denied'
              }
            }
          }
          catch {
            return 'Device access unavailable'
          }
          return null
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          reason = await Promise.race([authorize(), new Promise<string>(resolve => {
            timer = setTimeout(() => resolve('Device access lookup timed out'),
              Math.max(0, entry.deadline - Date.now()))
          })])
        }
        finally {
          clearTimeout(timer)
        }
        if (queue.failed) {
          return
        }
        // Re-authorize the undelivered tail after benign notifications, preserving
        // the original deadline even if notifications keep invalidating reads.
        if (!current(validatedAt)) {
          snapshots = new Map()
          commandClass = undefined
          if (Date.now() >= entry.deadline) {
            failChannel(channel, queue, 'Device access lookup timed out')
            return
          }
          continue
        }
        if (snapshotExpires === Infinity) {
          snapshotExpires = Date.now() + cacheMs
        }
        if (!reason && input && typeof validatedAt === 'number' && devicePolicy?.current) {
          inputPermissions.delete(channel)
          inputPermissions.set(channel, {checkpoint: validatedAt
            , until: snapshotExpires, groups: subscribed, identity, reservationId})
          if (inputPermissions.size > 128) {
            inputPermissions.delete(inputPermissions.keys().next().value!)
          }
        }
      }
      if (!current(validatedAt)) {
        commandClass = undefined
        continue
      }
      // The user's own join was announced but its row is not written yet. Re-read
      // with backoff until it persists rather than deny; the decision still comes
      // from the row, and both the original deadline and persistWaitMs bound it.
      if (reason === 'Device access denied' &&
          devicePolicy?.awaitingJoin?.(channel, user.email, user.groups.subscribed)) {
        if (joinWait?.entry !== entry) {
          joinWait = {entry, start: Date.now(), retries: 0}
        }
        const until = Math.min(entry.deadline, joinWait.start + persistWaitMs)
        if (Date.now() < until) {
          const step = Math.min(persistRetryMs * 2 ** joinWait.retries++, 250, until - Date.now())
          await new Promise(resolve => setTimeout(resolve, Math.max(1, step)))
          if (queue.failed) {
            return
          }
          snapshots = new Map()
          commandClass = undefined
          continue
        }
      }
      if (input && event !== 'input.gestureStart' && gestures.has(channel) &&
          gestures.get(channel)!.identity !== identity) {
        reason = 'Device access denied'
      }
      if (reason) {
        failChannel(channel, queue, reason)
        return
      }
      if (event === 'input.gestureStart') {
        if (gestureCounter === Number.MAX_SAFE_INTEGER) {
          failChannel(channel, queue, 'Device gesture counter exhausted; reconnect to continue')
          return
        }
        const {screenSessionId} = (entry.packet[2] || {}) as {screenSessionId?: unknown}
        const scope: AuthorizedInput = {
          gestureId: gestureSource + ':' + ++gestureCounter + ':' + Date.now(), reservationId
        }
        if (channel.startsWith('ios:') && typeof screenSessionId === 'string' &&
            /^[a-z0-9-]{1,128}$/i.test(screenSessionId)) {
          scope.screenSessionId = screenSessionId
        }
        gestures.set(channel, {identity, scope})
        if (gestures.size > 128) {
          const oldest = gestures.keys().next().value!
          const previous = gestures.get(oldest)!
          options.resetGesture?.(oldest, previous.scope)
          gestures.delete(oldest)
        }
      }
      if (input) {
        options.onAuthorizedInput?.(entry.packet,
          gestures.get(channel)?.scope || {gestureId: null, reservationId})
      }
      if (event === 'display.rotate') {
        options.onAuthorizedRotation?.(entry.packet[2], reservationId)
      }
      if (event === 'input.gestureStop') {
        gestures.delete(channel)
      }
      queue.pending.shift()
      finish(entry)
    }
    if (queues.get(channel) === queue) {
      queues.delete(channel)
    }
  }

  return (packet: readonly unknown[], next: (error?: Error) => void) => {
    const [event, channel] = packet
    const checkDevice = devicePolicy?.matches(event) || false
    const ios = typeof channel === 'string' && channel.startsWith('ios:')
    if (!ios && !checkDevice) {
      next()
      return
    }
    const entry = {packet, next, deadline: Date.now() + timeoutMs, done: false}
    pendingCount++
    if (typeof channel !== 'string' || channel.length > 256) {
      finish(entry, 'Device access denied')
      return
    }
    let queue = queues.get(channel)
    const start = !queue
    if (!queue && queues.size >= maxChannels) {
      finish(entry, 'Device access queue limit exceeded')
      return
    }
    if (!queue) {
      queue = {pending: [], failed: false}
      queues.set(channel, queue)
    }
    queue.pending.push(entry)
    if (queue.pending.length > maxPending || pendingCount > maxTotalPending) {
      failChannel(channel, queue, 'Device access queue limit exceeded')
      return
    }
    if (start) {
      drain(channel, queue).catch(() => failChannel(channel, queue!, 'Device access unavailable'))
    }
  }
}
