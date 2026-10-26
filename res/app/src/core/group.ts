import {emit} from './socket'
import {api} from './api'
import {createTransaction, TransactionError} from './transaction'
import type {Device} from './devices/types'
import {isAutomated} from './devices/enhance'

function request(action: 'group.invite' | 'group.kick', device: Device): Promise<Device> {
  const tx = createTransaction(device)
  emit(action, device.channel, tx.channel, {
    requirements: {
      serial: {
        value: device.serial
        , match: 'exact'
      }
    }
  })
  return tx.promise
    .then((result) => action === 'group.invite' && result.body?.owner ?
      {...result.device, owner: result.body.owner} : result.device)
    .catch((error) => {
      if (error instanceof TransactionError) {
        throw new Error('Device refused to join the group')
      }
      throw error
    })
}

export function inviteDevice(device: Device): Promise<Device> {
  if (isAutomated(device) || !device.usable) {
    return Promise.reject(new Error('Device is not usable'))
  }
  return request('group.invite', device)
}

export function kickDevice(device: Device, force = false): Promise<Device> {
  if (isAutomated(device) || (!force && !device.usable)) {
    return Promise.reject(new Error('Device is not usable'))
  }
  return request('group.kick', device)
}

// Use the API for explicit administrative release and popup cleanup, which can
// finish after the child window's socket has already disappeared.
export function releaseDevice(device: Device): Promise<void> {
  if (!device.owner?.reservationId || !device.channel) {
    return Promise.reject(new Error('Device ownership is unavailable'))
  }
  const query = new URLSearchParams({
    reservationId: device.owner.reservationId
    , deviceChannel: device.channel
  })
  return api.delete(`/api/v1/user/devices/${encodeURIComponent(device.serial)}?${query}`)
}
