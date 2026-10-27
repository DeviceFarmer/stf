import type {Device} from '@/core/devices/types'
import {currentUser} from '@/core/user'

export const standaloneSessionType = 'stf:standalone-session'

export interface StandaloneSession {
  type: typeof standaloneSessionType
  serial: string
  manual: boolean
  channel?: string | undefined
  ownerEmail?: string | undefined
  reservationId?: string | undefined
}

export function reportStandaloneSession(device: Device, manual: boolean): void {
  if (!window.opener) {
    return
  }
  const owned = manual && device.owner?.email === currentUser.email && Boolean(device.owner.reservationId)
  const message: StandaloneSession = {
    type: standaloneSessionType
    , serial: device.serial
    , manual: owned
    , channel: device.channel
    , ownerEmail: device.owner?.email
    , reservationId: device.owner?.reservationId
  }
  window.opener.postMessage(message, window.location.origin)
}
