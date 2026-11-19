import {isValidSerial} from './access.js'
import type {DeviceAccess, LoadDevice} from './access.js'

const deviceCommands = new Set([
  'input', 'display', 'clipboard', 'device', 'account', 'sd', 'ringer', 'wifi', 'bluetooth'
, 'group', 'shell', 'forward', 'logcat', 'connect', 'browser', 'store', 'screen', 'fs'
])
const maxEntries = 128

export function isDeviceCommand(event: unknown): boolean {
  if (typeof event !== 'string') {
    return false
  }
  const family = event.slice(0, event.indexOf('.'))
  return event !== 'device.note' && deviceCommands.has(family)
}

/** Wire notifications take precedence while their database writes are pending. */
// What the last lagging row said; empty strings mean the row had no channel or group.
interface LaggingRow {
  channel: string
  group: string
}

export class DevicePacketAccess {
  private readonly channels = new Map<string, string>()
  private readonly changed = new Map<string, number>()
  private readonly sessions = new Map<string, number>()
  private readonly observations = new Map<string, Partial<DeviceAccess>>()
  // Serials whose last snapshot lagged an observation that the row can still catch up with.
  private readonly lagging = new Map<string, LaggingRow>()
  private readonly misses = new Map<string, {until: number, groups: string}>()
  private readonly resolving = new Map<string, Promise<DeviceAccess | null | undefined>>()
  // This user's group.invite transactions still waiting for a reply, by response channel.
  private readonly invites = new Map<string, {channel: string, session: number}>()
  private revision = 0
  private subscriptionsChanged = 0
  private overflowed = false

  constructor(
    private readonly loadChannel: (channel: string, groups: string[]) =>
      PromiseLike<DeviceAccess | null | undefined>
  , private readonly load: LoadDevice
  , private readonly maxObservations = 4096
  ) {}

  joined(serial: string, usage?: string | null, owner?: DeviceAccess['owner']) {
    this.sessions.set(serial, this.revision + 1)
    this.update(serial, {usage: usage || null, ...(owner ? {owner} : {})})
  }

  released(serial: string) {
    this.sessions.set(serial, this.revision + 1)
    this.update(serial, {owner: null, usage: null})
  }

  /** Remembers this user's invite, so that its reply can stand in for a late join notification. */
  invited(responseChannel: string, channel: string) {
    this.invites.delete(responseChannel)
    this.invites.set(responseChannel, {channel, session: this.session(channel)})
    if (this.invites.size > maxEntries) {
      this.invites.delete(this.invites.keys().next().value!)
    }
  }

  forgetInvite(responseChannel: string) {
    this.invites.delete(responseChannel)
  }

  /**
   * The device answers an invite after announcing the join, but the two can reach
   * this socket through different processors, so the reply may come first. Treat
   * a successful reply naming this user as the join, unless a join or leave for the
   * device was seen since the invite went out, which is at least as new. Like any
   * notification, this only makes the guard wait for the row; it never allows.
   */
  inviteReplied(responseChannel: string, serial: string, email: string
  , owner: DeviceAccess['owner'] | undefined) {
    const invite = this.invites.get(responseChannel)
    if (!invite) {
      return
    }
    this.invites.delete(responseChannel)
    if (owner?.email && owner.email === email && this.source(invite.channel) === serial &&
        this.session(invite.channel) === invite.session) {
      this.joined(serial, null, owner)
    }
  }

  update(serial: string, change: Partial<DeviceAccess>) {
    this.invalidate(serial)
    const previous = this.observations.get(serial)
    this.observations.delete(serial)
    this.lagging.delete(serial)
    if (!previous && this.observations.size >= this.maxObservations) {
      // These are trusted wire observations, not request cache entries. Losing
      // one could authorize an old database row, so keep this socket read-only.
      this.overflowed = true
      this.lagging.clear()
      this.invalidate()
      return
    }
    this.observations.set(serial, {...previous, ...change})
    if (change.channel) {
      this.remember(change.channel, serial)
    }
  }

  session(channel: string): number {
    return this.sessions.get(this.source(channel)) || 0
  }

  snapshot(device: DeviceAccess): DeviceAccess {
    if (this.overflowed) {
      return {...device, ready: false}
    }
    const observed = this.observations.get(device.serial)
    if (!observed) {
      return device
    }
    const sameOwner = (left: DeviceAccess['owner'], right: DeviceAccess['owner']) =>
      (left?.email || null) === (right?.email || null) &&
      (left?.reservationId || null) === (right?.reservationId || null)
    const caughtUp = Object.entries(observed).every(([field, value]) => {
      if (field === 'owner') {
        return sameOwner(device.owner, observed.owner)
      }
      if (field === 'group') {
        return device.group?.id === observed.group?.id
      }
      if (field === 'usage') {
        return (device.usage || null) === (value || null)
      }
      return device[field as keyof DeviceAccess] === value
    })
    if (!caughtUp) {
      // A row owned by someone else will not turn into the observed owner by waiting.
      const rowOwner = device.owner?.email
      if (!rowOwner || rowOwner === observed.owner?.email) {
        this.lagging.set(device.serial, {
          channel: device.channel ?? '', group: device.group?.id ?? ''
        })
      }
      else {
        this.lagging.delete(device.serial)
      }
      // Never turn an old database row into an allow using a notification.
      // Wait for persistence; this also fences reads from before a transfer.
      return {...device, ready: false}
    }
    this.observations.delete(device.serial)
    this.lagging.delete(device.serial)
    // Force concurrent snapshots from before persistence to be read again.
    this.invalidate(device.serial)
    return device
  }

  /**
   * Whether a denied command should be retried against the database instead of
   * failing: the outstanding observation is a manual join by `email`, and the
   * last row read still lags it in a way persistence can fix. That means the row
   * is free or already the same user's, and its channel and group are ones this
   * user may use. A row owned by someone else, a revoked group or a channel
   * mismatch deny immediately. This only buys time; it never authorizes, as an
   * allow still needs a caught-up row. Read-only, unlike snapshot().
   */
  awaitingJoin(channel: string, email: string, groups: string[] = []): boolean {
    if (this.overflowed) {
      return false
    }
    const serial = this.source(channel)
    const observed = this.observations.get(serial)
    const row = this.lagging.get(serial)
    return Boolean(row && observed?.owner?.email && observed.owner.email === email &&
      observed.usage !== 'automation' && observed.present !== false &&
      observed.ready !== false && row.channel === channel &&
      row.group !== '' && groups.includes(row.group))
  }

  invalidate(serial?: string) {
    // An unknown channel has no serial yet, so even a targeted notification
    // invalidates negative results and any in-flight miss.
    this.misses.clear()
    if (this.sessions.size > maxEntries) {
      this.sessions.delete(this.sessions.keys().next().value!)
      this.subscriptionsChanged = ++this.revision
    }
    if (serial) {
      this.changed.delete(serial)
      this.changed.set(serial, ++this.revision)
      if (this.changed.size > maxEntries) {
        this.changed.clear()
        this.subscriptionsChanged = this.revision
      }
    }
    else {
      this.subscriptionsChanged = ++this.revision
    }
  }

  checkpoint(): number {
    return this.revision
  }

  current(channel: string, checkpoint: number): boolean {
    return this.subscriptionsChanged <= checkpoint &&
      (this.changed.get(this.source(channel)) || 0) <= checkpoint
  }

  source(channel: string): string {
    return channel.startsWith('ios:') ? channel.slice(4) : this.channels.get(channel) || channel
  }

  private remember(channel: string, serial: string) {
    this.channels.delete(channel)
    this.channels.set(channel, serial)
    if (this.channels.size > maxEntries) {
      this.channels.delete(this.channels.keys().next().value!)
      // Cached permissions may still reference the evicted channel. They must
      // re-resolve it before a targeted serial notification can be trusted.
      this.invalidate()
    }
  }

  private async resolve(channel: string, groups: string[]): Promise<string | undefined> {
    const known = this.channels.get(channel)
    if (known) {
      return known
    }
    const subscribed = JSON.stringify(groups)
    const miss = this.misses.get(channel)
    if (miss && miss.until > Date.now() && miss.groups === subscribed) {
      return undefined
    }
    const revision = this.revision
    const key = JSON.stringify([channel, groups])
    let pending = this.resolving.get(key)
    if (!pending) {
      if (this.resolving.size >= maxEntries) {
        return undefined
      }
      pending = Promise.resolve().then(() => this.loadChannel(channel, groups))
      this.resolving.set(key, pending)
    }
    let device: DeviceAccess | null | undefined
    try {
      device = await pending
    }
    finally {
      if (this.resolving.get(key) === pending) {
        this.resolving.delete(key)
      }
    }
    if (device?.channel === channel) {
      this.remember(channel, device.serial)
      return device.serial
    }
    if (revision === this.revision) {
      this.misses.delete(channel)
      this.misses.set(channel, {until: Date.now() + 250, groups: subscribed})
      if (this.misses.size > maxEntries) {
        this.misses.delete(this.misses.keys().next().value!)
      }
    }
    return undefined
  }

  async allows(channel: unknown, groups: string[], load: LoadDevice = this.load): Promise<boolean> {
    if (this.overflowed || typeof channel !== 'string' || channel.length > 256) {
      return false
    }
    const serial = channel.startsWith('ios:') ? channel.slice(4) :
      await this.resolve(channel, groups)
    if (!isValidSerial(serial)) {
      return false
    }
    const loaded = await load(serial)
    const device = loaded && this.snapshot(loaded)
    return Boolean(device && device.channel === channel && device.present && device.ready &&
      device.group?.id && groups.includes(device.group.id) &&
      device.usage !== 'automation')
  }
}
