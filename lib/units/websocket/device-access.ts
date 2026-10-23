import type {LoadDevice} from './ios-access.js'

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

const deviceCommands = new Set([
  'input', 'display', 'clipboard', 'device', 'account', 'sd', 'ringer', 'wifi', 'bluetooth'
, 'group', 'shell', 'forward', 'logcat', 'connect', 'browser', 'store', 'screen', 'fs'
])

export function isDeviceCommand(event: unknown): boolean {
  if (typeof event !== 'string') {
    return false
  }
  const family = event.slice(0, event.indexOf('.'))
  return event !== 'device.note' && deviceCommands.has(family)
}

/** Checks the current lease before forwarding manual UI commands, including old tabs. */
export class DevicePacketAccess {
  private readonly channels = new Map<string, string>()
  private readonly automated = new Set<string>()

  constructor(
    private readonly loadVisible: (groups: string[]) => PromiseLike<DeviceAccess[]>
  , private readonly load: (serial: string) => PromiseLike<DeviceAccess | null | undefined>
  ) {}

  joined(serial: string, usage?: string | null) {
    if (usage === 'automation') {
      this.automated.add(serial)
    }
    else {
      this.automated.delete(serial)
    }
  }

  released(serial: string) {
    this.automated.delete(serial)
  }

  source(channel: string): string {
    return channel.startsWith('ios:') ? channel.slice(4) : this.channels.get(channel) || channel
  }

  async allows(channel: unknown, groups: string[], load: LoadDevice = this.load): Promise<boolean> {
    if (typeof channel !== 'string') {
      return false
    }
    let serial = this.channels.get(channel)
    if (!serial) {
      if (channel.startsWith('ios:')) {
        serial = channel.slice(4)
        if (!/^[A-Za-z0-9-]{1,128}$/.test(serial)) {
          return false
        }
      }
      else {
        const visible = await this.loadVisible(groups)
        for (const device of visible) {
          if (device.channel) {
            this.channels.set(device.channel, device.serial)
          }
        }
        serial = this.channels.get(channel)
      }
    }
    if (!serial || this.automated.has(serial)) {
      return false
    }
    const device = await load(serial)
    return Boolean(!this.automated.has(serial) && device && device.channel === channel &&
      device.present && device.ready &&
      device.group?.id && groups.includes(device.group.id) &&
      !(device.owner && device.usage === 'automation'))
  }
}
