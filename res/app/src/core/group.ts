import {emit} from './socket'
import {createTransaction, TransactionError} from './transaction'
import type {Device} from './devices/types'

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
    .then((result) => result.device)
    .catch((error) => {
      if (error instanceof TransactionError) {
        throw new Error('Device refused to join the group')
      }
      throw error
    })
}

export function inviteDevice(device: Device): Promise<Device> {
  if (!device.usable) {
    return Promise.reject(new Error('Device is not usable'))
  }
  return request('group.invite', device)
}

export function kickDevice(device: Device, force = false): Promise<Device> {
  if (!force && !device.usable) {
    return Promise.reject(new Error('Device is not usable'))
  }
  return request('group.kick', device)
}
