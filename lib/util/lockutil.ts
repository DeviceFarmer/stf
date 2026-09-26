/**
* Copyright © 2019,2023 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import type Promise from 'bluebird'

import apiutil from './apiutil.js'
import dbapi from '../db/api.js'
import type {Response} from 'express'
import type {WriteResult} from 'rethinkdb'

type LockStats = WriteResult & apiutil.Stats

interface GroupLockRequest {
  swagger: {
    params: {id: apiutil.Parameter<string>}
  }
  user: {email: string}
}

interface DeviceLockRequest {
  swagger: {
    params: {serial: apiutil.Parameter<string>}
  }
  user: {groups: {subscribed: string[]}}
  body?: {serial: string}
}

type DeviceLocker = (groups: string[], serial: string) => Promise<LockStats>

interface LockUtil {
  unlockDevice(lock: apiutil.Holder): void
  lockUser(email: string, res: Response, lock: apiutil.Holder): Promise<boolean>
  unlockUser(lock: apiutil.Holder): void
  lockGroupAndUser(req: GroupLockRequest, res: Response, lock: apiutil.Holder): Promise<boolean>
  unlockGroupAndUser(lock: apiutil.Holder): void
  lockGroup(req: GroupLockRequest, res: Response, lock: apiutil.Holder): Promise<boolean>
  unlockGroup(lock: apiutil.Holder): void
  unlockGroupAndDevice(lock: apiutil.Holder): void
  lockGenericDevice(
    req: DeviceLockRequest
  , res: Response
  , lock: apiutil.Holder
  , lockDevice: DeviceLocker
  ): Promise<boolean>
}

const lockutil: LockUtil = Object.create(null)

lockutil.unlockDevice = function(lock: apiutil.Holder) {
  if (lock.device) {
    dbapi.unlockDevice(lock.device.serial)
  }
}

lockutil.lockUser = function(email: string, res: Response, lock: apiutil.Holder) {
  return dbapi.lockUser(email)
    .then(function(stats: LockStats) {
      return apiutil.computeStats(res, stats, 'user', lock)
    })
}

lockutil.unlockUser = function(lock: apiutil.Holder) {
  if (lock.user) {
    dbapi.unlockUser(lock.user.email)
  }
}

lockutil.lockGroupAndUser = function(req: GroupLockRequest, res: Response, lock: apiutil.Holder) {
  return lockutil.lockGroup(req, res, lock).then(function(lockingSuccessed) {
    return lockingSuccessed ?
      lockutil.lockUser(req.user.email, res, lock) :
      false
  })
}

lockutil.unlockGroupAndUser = function(lock: apiutil.Holder) {
  lockutil.unlockGroup(lock)
  lockutil.unlockUser(lock)
}

lockutil.lockGroup = function(req: GroupLockRequest, res: Response, lock: apiutil.Holder) {
  const id = req.swagger.params.id.value
  const email = req.user.email

  return dbapi.lockGroupByOwner(email, id).then(function(stats: LockStats) {
    return apiutil.computeStats(res, stats, 'group', lock)
  })
}

lockutil.unlockGroup = function(lock: apiutil.Holder) {
  if (lock.group) {
    dbapi.unlockGroup(lock.group.id)
  }
}

lockutil.unlockGroupAndDevice = function(lock: apiutil.Holder) {
  lockutil.unlockGroup(lock)
  lockutil.unlockDevice(lock)
}

lockutil.lockGenericDevice = function(
  req: DeviceLockRequest
, res: Response
, lock: apiutil.Holder
, lockDevice: DeviceLocker
) {
  return lockDevice(req.user.groups.subscribed,
                    req.hasOwnProperty('body') ? req.body!.serial : req.swagger.params.serial.value)

    .then(function(stats) {
      return apiutil.computeStats(res, stats, 'device', lock)
    })
}

export default lockutil
