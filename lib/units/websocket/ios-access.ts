interface DeviceAccess {
  serial: string
  platform?: string
  channel?: string
  present?: boolean
  ready?: boolean
  group?: {id?: string}
  owner?: {email?: string} | null
}

export async function allowIosPacket(
  event: string
, channel: unknown
, user: {email: string, groups: {subscribed: string[]}}
, load: (serial: string) => PromiseLike<DeviceAccess | null | undefined>
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
  return device.owner?.email === user.email || (event === 'group.invite' && !device.owner)
}
