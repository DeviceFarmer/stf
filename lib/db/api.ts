/**
* Copyright © 2019-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import r from 'rethinkdb'
import util from 'util'

import db from './index.js'
import wireutil from '../wire/util.js'

var dbapi: DbApi = Object.create(null)

import * as uuid from 'uuid'
import apiutil from '../util/apiutil.js'
import Promise from 'bluebird'
import _ from 'lodash'
import logger from '../util/logger.js'
import deviceutil from '../util/deviceutil.js'
import type {
  AccessTokenDocument
, AdbKey
, AdminGroupLock
, AlertMessage
, BootStrapEnv
, CreatedUserGroup
, DeviceBattery
, DeviceBrowser
, DeviceConnectivity
, DeviceDocument
, DeviceGroup
, DeviceIdentity
, DeviceInitialState
, DeviceLogEntry
, DeviceOwner
, DevicePhoneState
, GroupCreateData
, GroupDocument
, GroupRef
, LockedWriteResult
, UserDocument
, UserIdentity
} from '../types/stf.js'
import type {ReverseForwardFields} from '../types/wire.js'

type UserExpression = r.Expression<UserDocument>

type InitialDeviceRow = Pick<
  DeviceDocument
, 'present' | 'provider' | 'status' | 'statusTimeStamp' | 'ready' | 'reverseForwards'
  | 'remoteConnect' | 'remoteConnectUrl' | 'usage' | 'logs_enabled'
> & {
  owner: null
  presenceChangedAt: r.Expression<r.Time>
  statusChangedAt: r.Expression<r.Time>
  serial?: string
  createdAt?: r.Expression<r.Time>
  group?: DeviceGroup
}

type DeviceGroupSource = Pick<
  GroupDocument
, 'id' | 'name' | 'owner' | 'dates' | 'class' | 'repetitions'
>

interface DbApi {
  DuplicateSecondaryIndexError: new() => Error
  close(options?: unknown): Promise<void>
  unlockBookingObjects(): Promise<r.WriteResult[]>
  updateBootStrap(rootGroup: GroupDocument, env: BootStrapEnv): Promise<boolean | r.WriteResult>
  createBootStrap(env: BootStrapEnv): Promise<r.WriteResult>
  deleteDevice(serial: string): Promise<r.WriteResult>
  deleteUser(email: string): Promise<r.WriteResult>
  getReadyGroupsOrderByIndex(index: string): Promise<GroupDocument[]>
  getGroupsByIndex(value: string, index: string): Promise<GroupDocument[]>
  getGroupByIndex(value: string, index: string): Promise<GroupDocument | undefined>
  getGroupsByUser(email: string): Promise<GroupDocument[]>
  getGroup(id: string): Promise<GroupDocument | null>
  getGroups(): Promise<GroupDocument[]>
  getUsers(): Promise<UserDocument[]>
  getEmails(): Promise<string[]>
  addGroupUser(id: string, email: string): Promise<'unchanged' | 'added'>
  removeGroupUser(id: string, email: string): Promise<'deleted'>
  lockBookableDevice(groups: string[], serial: string): Promise<LockedWriteResult>
  lockDeviceByCurrent(groups: string[], serial: string): Promise<LockedWriteResult>
  lockDeviceByOrigin(groups: string[], serial: string): Promise<LockedWriteResult>
  addOriginGroupDevice(group: GroupRef, serial: string): Promise<GroupDocument | null>
  removeOriginGroupDevice(group: GroupRef, serial: string): Promise<GroupDocument | null>
  addGroupDevices(group: GroupDocument, serials: string[]): Promise<GroupDocument | null>
  removeGroupDevices(group: GroupDocument, serials: string[]): Promise<GroupDocument | null>
  lockDevice(serial: string): Promise<r.WriteResult>
  unlockDevice(serial: string): Promise<r.WriteResult>
  lockUser(email: string): Promise<LockedWriteResult>
  unlockUser(email: string): Promise<r.WriteResult>
  lockGroupByOwner(email: string, id: string): Promise<LockedWriteResult>
  lockGroup(id: string): Promise<r.WriteResult & {locked: boolean}>
  unlockGroup(id: string): Promise<r.WriteResult>
  adminLockGroup(id: string, lock: AdminGroupLock): Promise<true | undefined>
  adminUnlockGroup(lock: AdminGroupLock): Promise<r.WriteResult> | true
  getRootGroup(): Promise<GroupDocument>
  getUserGroup(email: string, id: string): Promise<GroupDocument | undefined>
  getUserGroups(email: string): Promise<GroupDocument[]>
  getOnlyUserGroups(email: string): Promise<GroupDocument[]>
  getTransientGroups(): Promise<GroupDocument[]>
  getDeviceTransientGroups(serial: string): Promise<GroupDocument[]>
  isDeviceBooked(serial: string): Promise<boolean>
  isRemoveGroupUserAllowed(email: string, targetGroup: GroupDocument): Promise<boolean>
  isUpdateDeviceOriginGroupAllowed(serial: string, targetGroup: GroupDocument): Promise<boolean>
  getDeviceGroups(serial: string): Promise<GroupDocument[]>
  getGroupAsOwnerOrAdmin(email: string, id: string): Promise<GroupDocument | false>
  getOwnerGroups(email: string): Promise<GroupDocument[]>
  createGroup(data: GroupCreateData): Promise<GroupDocument>
  createUserGroup(data: GroupCreateData): Promise<CreatedUserGroup>
  updateGroup(id: string, data: Partial<GroupDocument>): Promise<GroupDocument | null>
  reserveUserGroupInstance(email: string): Promise<r.WriteResult>
  releaseUserGroupInstance(email: string): Promise<r.WriteResult>
  updateUserGroupDuration(
    email: string
  , oldDuration: number
  , newDuration: number
  ): Promise<r.WriteResult>
  updateUserGroupsQuotas(
    email: string
  , duration: number | null
  , number: number | null
  , repetitions: number | null
  ): Promise<r.WriteResultWithChanges>
  updateDefaultUserGroupsQuotas(
    email: string
  , duration: number | null
  , number: number | null
  , repetitions: number | null
  ): Promise<r.WriteResultWithChanges>
  updateDeviceGroupName(
    serial: string
  , group: Pick<GroupDocument, 'name' | 'class' | 'isActive'>
  ): Promise<r.WriteResult>
  updateDeviceCurrentGroupFromOrigin(serial: string): Promise<r.WriteResult>
  askUpdateDeviceOriginGroup(
    serial: string
  , group: GroupRef
  , signature: string
  ): Promise<r.WriteResult>
  updateDeviceOriginGroup(serial: string, group: DeviceGroupSource): Promise<DeviceDocument | null>
  updateDeviceCurrentGroup(serial: string, group: DeviceGroupSource): Promise<r.WriteResult>
  updateUserGroup(
    group: GroupDocument
  , data: Partial<GroupDocument> & Pick<GroupDocument, 'duration'>
  ): Promise<GroupDocument | null | false>
  deleteGroup(id: string): Promise<r.WriteResult>
  deleteUserGroup(id: string): Promise<'deleted' | 'forbidden'>
  createUser(email: string, name: string, ip: string): Promise<r.WriteResultWithChanges>
  checkUserBeforeLogin(user: Pick<UserDocument, 'email' | 'name'>): Promise<boolean>
  saveUserAfterLogin(
    user: Pick<UserDocument, 'email' | 'name' | 'ip'>
  ): Promise<r.WriteResultWithChanges | null>
  loadUser(email: string): Promise<UserDocument | null>
  updateUsersAlertMessage(alertMessage: Partial<AlertMessage>): Promise<r.WriteResultWithChanges>
  updateUserSettings(email: string, changes: object): Promise<r.WriteResult>
  resetUserSettings(email: string): Promise<r.WriteResult>
  insertUserAdbKey(email: string, key: AdbKey): Promise<r.WriteResult>
  setUserAdbPublicKey(fingerprint: string, publicKey: string): Promise<r.WriteResult>
  loadUserAdbPublicKeys(email: string): Promise<string[]>
  deleteUserAdbKey(email: string, fingerprint: string): Promise<r.WriteResult>
  lookupUsersByAdbKey(fingerprint: string): Promise<r.Cursor>
  lookupUserByAdbFingerprint(fingerprint: string): Promise<UserIdentity | null>
  lookupUserByVncAuthResponse(response: string, serial: string): Promise<UserIdentity | null>
  loadUserDevices(email: string): Promise<r.Cursor>
  saveDeviceLog(serial: string, entry: DeviceLogEntry): Promise<r.WriteResult>
  saveDeviceInitialState(serial: string, device: DeviceInitialState): Promise<DeviceDocument | null>
  setDeviceConnectUrl(serial: string, url: string): Promise<r.WriteResult>
  unsetDeviceConnectUrl(serial: string): Promise<r.WriteResult>
  saveDeviceStatus(serial: string, status: number, statusTimeStamp: number): Promise<r.WriteResult>
  setDeviceOwner(serial: string, owner: DeviceOwner): Promise<r.WriteResult>
  unsetDeviceOwner(serial: string): Promise<r.WriteResult>
  reserveDeviceOwner(serial: string): Promise<r.WriteResult>
  clearDeviceRestoreOwner(serial: string): Promise<r.WriteResult>
  setDevicePresent(serial: string): Promise<r.WriteResult>
  setDeviceAbsent(serial: string): Promise<r.WriteResult>
  setDeviceUsage(serial: string, usage: string): Promise<r.WriteResult>
  unsetDeviceUsage(serial: string): Promise<r.WriteResult>
  setDeviceAirplaneMode(serial: string, enabled: boolean): Promise<r.WriteResult>
  setDeviceBattery(serial: string, battery: DeviceBattery): Promise<r.WriteResult>
  setDeviceBrowser(serial: string, browser: DeviceBrowser): Promise<r.WriteResult>
  setDeviceConnectivity(serial: string, connectivity: DeviceConnectivity): Promise<r.WriteResult>
  setDevicePhoneState(serial: string, state: DevicePhoneState): Promise<r.WriteResult>
  setDeviceRotation(serial: string, rotation: number): Promise<r.WriteResult>
  setDeviceNote(serial: string, note: string): Promise<r.WriteResult>
  setDeviceReverseForwards(serial: string, forwards: ReverseForwardFields[]): Promise<r.WriteResult>
  setDeviceReady(serial: string, channel: string): Promise<r.WriteResultWithChanges>
  saveDeviceIdentity(serial: string, identity: DeviceIdentity): Promise<r.WriteResult>
  getDevices(): Promise<DeviceDocument[]>
  loadDevices(groups: string[]): Promise<DeviceDocument[]>
  loadDevicesByOrigin(groups: string[]): Promise<DeviceDocument[]>
  loadBookableDevices(groups: string[]): Promise<DeviceDocument[]>
  loadStandardDevices(groups: string[]): Promise<DeviceDocument[]>
  loadPresentDevices(): Promise<r.Cursor>
  loadDeviceBySerial(serial: string): Promise<DeviceDocument | null>
  loadDevice(groups: string[], serial: string): Promise<r.Cursor>
  loadBookableDevice(groups: string[], serial: string): Promise<DeviceDocument[]>
  loadDeviceByCurrent(groups: string[], serial: string): Promise<DeviceDocument[]>
  loadDeviceByOrigin(groups: string[], serial: string): Promise<DeviceDocument[]>
  saveUserAccessToken(
    email: string
  , token: Pick<AccessTokenDocument, 'id' | 'title' | 'jwt'>
  ): Promise<r.WriteResultWithChanges>
  removeUserAccessTokens(email: string): Promise<r.WriteResult>
  removeUserAccessToken(email: string, title: string): Promise<r.WriteResult>
  removeAccessToken(id: string): Promise<r.WriteResult>
  loadAccessTokens(email: string): Promise<r.Cursor>
  loadAccessToken(id: string): Promise<AccessTokenDocument | null>
}
const log = logger.createLogger('db:api')

function getDevices() {
  return db.run(r.table('devices'))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.DuplicateSecondaryIndexError = class DuplicateSecondaryIndexError extends Error {
  constructor() {
    super()
    this.name = 'DuplicateSecondaryIndexError'
    Error.captureStackTrace(this, DuplicateSecondaryIndexError)
  }
}

dbapi.close = function(options) {
  return db.close(options)
}

dbapi.unlockBookingObjects = function() {
  return Promise.all([
    db.run(r.table('users').update({groups: {lock: false}}))
  , db.run(r.table('devices').update({group: {lock: false}}))
  , db.run(r.table('groups').update({lock: {admin: false, user: false}}))
  ])
}

dbapi.updateBootStrap = function(rootGroup, env) {
  const rootGroupNameHasChanged = rootGroup.name !== env.STF_ROOT_GROUP_NAME
  const adminEmailHasChanged = rootGroup.owner.email !== env.STF_ADMIN_EMAIL
  const adminNameHasChanged = rootGroup.owner.name !== env.STF_ADMIN_NAME

  function createNewAdminUser(): Promise<boolean | r.WriteResult> {
    if (!adminEmailHasChanged) {
      if (adminNameHasChanged) {
        log.error('Forbidden (user name cannot be changed)')
        return Promise.resolve(false)
      }
      return Promise.resolve(true)
    }

    return dbapi.createUser(env.STF_ADMIN_EMAIL,
                            env.STF_ADMIN_NAME,
                            '127.0.0.1').then<boolean | r.WriteResult>(function(stats) {
      if (!stats.inserted) {
        log.error('Forbidden (user already exists)')
        return false
      }
      log.info('Created (user name:%s email:%s)'
               , env.STF_ADMIN_NAME
               , env.STF_ADMIN_EMAIL)

      return dbapi.loadUser(rootGroup.owner.email).then(function(oldAdminUser) {
        return db.run(r.table('users').get<UserDocument>(env.STF_ADMIN_EMAIL).update({
          privilege: oldAdminUser!.privilege
        , groups: oldAdminUser!.groups
        , settings: oldAdminUser!.settings
        }))
      })
    })
    .catch(function(err) {
      log.error('Failed to create user')
      return Promise.reject(err)
    })
  }

  function updateDevicesForMigration() {
    return getDevices().then(function(devices) {
      return Promise.map(devices, function(device) {
        return db.run(r.table('devices').get<DeviceDocument>(device.serial).update({
          group: {
            name:
              r.branch(
               r.expr(rootGroupNameHasChanged)
                .eq(true)
                .and(r.row('group')('id')
                      .eq(rootGroup.id))
              , env.STF_ROOT_GROUP_NAME
              , r.row('group')('name'))
          , originName:
              r.branch(
               r.expr(rootGroupNameHasChanged)
                .eq(true)
                .and(r.row('group')('origin')
                      .eq(rootGroup.id))
              , env.STF_ROOT_GROUP_NAME
              , r.row('group')('originName'))
          , owner:
              r.branch(
               r.expr(adminEmailHasChanged)
                .eq(true)
                .and(r.row('group')('id')
                      .eq(rootGroup.id))
              , {
                  name: env.STF_ADMIN_NAME
                , email: env.STF_ADMIN_EMAIL
                }
              , r.row('group')('owner'))
          }
        }))
      })
    })
  }

  function updateGroupsForMigration(): Promise<r.WriteResult | r.WriteResult[]> {
    if (rootGroupNameHasChanged && !adminEmailHasChanged) {
      return db.run(r.table('groups').get<GroupDocument>(rootGroup.id).update({
        name: env.STF_ROOT_GROUP_NAME
      }))
    }

    return dbapi.getGroups().then(function(groups: GroupDocument[]) {
      return Promise.map(groups, function(group) {
        return db.run(r.table('groups').get<GroupDocument>(group.id).update({
          name:
            r.branch(
             r.expr(rootGroupNameHasChanged)
              .eq(true)
              .and(r.row('id')
                    .eq(rootGroup.id))
            , env.STF_ROOT_GROUP_NAME
            , r.row('name'))
        , owner:
            r.branch(
             r.expr(adminEmailHasChanged)
              .eq(true)
              .and(r.row('owner')('email')
                    .eq(rootGroup.owner.email))
            , {
                name: env.STF_ADMIN_NAME
              , email: env.STF_ADMIN_EMAIL
              }
            , r.row('owner'))
        , users:
            r.branch(
             r.expr(adminEmailHasChanged)
              .eq(true)
            , _.union([env.STF_ADMIN_EMAIL], _.difference(group.users, [rootGroup.owner.email]))
            , r.row('users'))
        }))
      })
    })
  }

  return createNewAdminUser().then<boolean | r.WriteResult>(function(success) {
    if (!success || !rootGroupNameHasChanged && !adminEmailHasChanged) {
      return false
    }

    return updateGroupsForMigration().then(function() {
      return updateDevicesForMigration()
    })
    .then<boolean | r.WriteResult>(function() {
      if (adminEmailHasChanged) {
        return dbapi.removeUserAccessTokens(rootGroup.owner.email)
      }
      return true
    })
    .then<boolean | r.WriteResult>(function() {
      if (adminEmailHasChanged) {
        return dbapi.deleteUser(rootGroup.owner.email)
      }
      return true
    })
  })
  .then(function(success) {
    if (success) {
      log.info('Built-in objects have been updated successfully')
    }
    return success
  })
  .catch(function(err) {
    log.error('Failed to update built-in objects, potential data consistency issue')
    return Promise.reject(err)
  })
}

dbapi.createBootStrap = function(env) {
  const now = Date.now()

  function updateUsersForMigration(group: GroupDocument) {
    return dbapi.getUsers().then(function(users: UserDocument[]) {
      return Promise.map(users, function(user) {
        return db.run(r.table('users').get<UserDocument>(user.email).update({
          privilege: user.email !== group.owner.email ? apiutil.USER : apiutil.ADMIN
        , groups: {
            subscribed: []
          , lock: false
          , quotas: {
              allocated: {
                number: group.envUserGroupsNumber
              , duration: group.envUserGroupsDuration
              }
            , consumed: {
                number: 0
              , duration: 0
              }
            , defaultGroupsNumber: user.email !== group.owner.email ?
                0 :
                group.envUserGroupsNumber
            , defaultGroupsDuration: user.email !== group.owner.email ?
                0 :
                group.envUserGroupsDuration
            , defaultGroupsRepetitions: user.email !== group.owner.email ?
                0 :
                group.envUserGroupsRepetitions
            , repetitions: group.envUserGroupsRepetitions
            }
          }
        }))
        .then<r.WriteResult | 'unchanged' | 'added'>(function(stats) {
          if (stats.replaced) {
            return dbapi.addGroupUser(group.id, user.email)
          }
          return stats
        })
      })
    })
  }

  function updateDevicesForMigration(group: GroupDocument) {
    return getDevices().then(function(devices) {
      return Promise.map(devices, function(device) {
        return db.run(r.table('devices').get<DeviceDocument>(device.serial).update({
          group: {
            id: group.id
          , name: group.name
          , lifeTime: group.dates[0]
          , owner: group.owner
          , origin: group.id
          , class: group.class
          , repetitions: group.repetitions
          , originName: group.name
          , lock: false
          }}
        ))
        .then<r.WriteResult | GroupDocument | null>(function(stats) {
          if (stats.replaced) {
            return dbapi.addOriginGroupDevice(group, device.serial)
          }
          return stats
        })
      })
    })
  }

  return dbapi.createGroup({
      name: env.STF_ROOT_GROUP_NAME
    , owner: {
        email: env.STF_ADMIN_EMAIL
      , name: env.STF_ADMIN_NAME
      }
    , users: [env.STF_ADMIN_EMAIL]
    , privilege: apiutil.ROOT
    , class: apiutil.STANDARD
    , repetitions: 0
    , duration: 0
    , isActive: true
    , state: apiutil.READY
    , dates: [{
                start: new Date(now)
              , stop: new Date(now + apiutil.ONE_YEAR)
             }]
    , envUserGroupsNumber: apiutil.MAX_USER_GROUPS_NUMBER
    , envUserGroupsDuration: apiutil.MAX_USER_GROUPS_DURATION
    , envUserGroupsRepetitions: apiutil.MAX_USER_GROUPS_REPETITIONS
    })
    .then(function(group) {
      return dbapi.saveUserAfterLogin({
        name: group.owner.name
      , email: group.owner.email
      , ip: '127.0.0.1'
      })
      .then(function(stats) {
        if (stats) {
          return updateUsersForMigration(group)
        }
        return dbapi.deleteGroup(group.id).then(function() {
          throw new Error('Found the same user with a different name')
        })
      })
      .then(function() {
        return updateDevicesForMigration(group)
      })
      .then(function() {
        return dbapi.reserveUserGroupInstance(group.owner.email)
      })
    })
}

dbapi.deleteDevice = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).delete())
}

dbapi.deleteUser = function(email) {
  return db.run(r.table('users').get<UserDocument>(email).delete())
}

dbapi.getReadyGroupsOrderByIndex = function(index) {
  return db
    .run(r.table('groups')
    .orderBy({index: index})
    .filter(function(group) {
      return group('state').ne(apiutil.PENDING)
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getGroupsByIndex = function(value, index) {
  return db.run(r.table('groups').getAll(value, {index: index}))
    .then(function(cursor) {
      return cursor.toArray()
    })
}


dbapi.getGroupByIndex = function(value, index) {
  return dbapi.getGroupsByIndex(value, index)
    .then(function(array) {
      return array[0]
    })
}

dbapi.getGroupsByUser = function(email) {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('users').contains(email)
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getGroup = function(id) {
  return db.run(r.table('groups').get<GroupDocument>(id))
}

dbapi.getGroups = function() {
  return db.run(r.table('groups'))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getUsers = function() {
  return db.run(r.table('users'))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getEmails = function() {
  return db.run(r.table('users').filter(function(user) {
    return user('privilege').ne(apiutil.ADMIN)
  })
  .getField('email'))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.addGroupUser = function(id, email) {
  return Promise.all([
    db.run(r.table('groups')
      .get<GroupDocument>(id)
      .update({users: r.row('users').setInsert(email)}))
  , db.run(r.table('users')
      .get<UserDocument>(email)
      .update({groups: {subscribed: r.row('groups')('subscribed').setInsert(id)}}))
  ])
  .then(function(statss) {
    return statss[0].unchanged ? 'unchanged' : 'added'
  })
}

dbapi.removeGroupUser = function(id, email) {
  return Promise.all([
    db.run(r.table('groups')
      .get<GroupDocument>(id)
      .update({users: r.row('users').setDifference([email])}))
  , db.run(r.table('users')
      .get<UserDocument>(email)
      .update({groups: {subscribed: r.row('groups')('subscribed').setDifference([id])}}))
  ])
  .then(function() {
    return 'deleted'
  })
}

dbapi.lockBookableDevice = function(groups, serial) {
  function wrappedlockBookableDevice() {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {lock:
      r.branch(
        r.row('group')('lock')
         .eq(false)
         .and(r.row('group')('class')
               .ne(apiutil.STANDARD))
         .and(r.expr(groups)
               .setIntersection([r.row('group')('origin')])
               .isEmpty()
               .not())
      , true
      , r.row('group')('lock'))
    }}, {returnChanges: true}))
    .then(function(stats) {
      return apiutil.lockDeviceResult(stats, dbapi.loadBookableDevice, groups, serial)
    })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockBookableDevice
  , 10
  , Math.random() * 500 + 50)
}

dbapi.lockDeviceByCurrent = function(groups, serial) {
  function wrappedlockDeviceByCurrent() {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {lock:
      r.branch(
        r.row('group')('lock')
         .eq(false)
         .and(r.expr(groups)
               .setIntersection([r.row('group')('id')])
               .isEmpty()
               .not())
      , true
      , r.row('group')('lock'))
    }}, {returnChanges: true}))
    .then(function(stats) {
      return apiutil.lockDeviceResult(stats, dbapi.loadDeviceByCurrent, groups, serial)
    })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockDeviceByCurrent
  , 10
  , Math.random() * 500 + 50)
}

dbapi.lockDeviceByOrigin = function(groups, serial) {
  function wrappedlockDeviceByOrigin() {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {lock:
      r.branch(
        r.row('group')('lock')
         .eq(false)
         .and(r.expr(groups)
               .setIntersection([r.row('group')('origin')])
               .isEmpty()
               .not())
      , true
      , r.row('group')('lock'))
    }}, {returnChanges: true}))
    .then(function(stats) {
      return apiutil.lockDeviceResult(stats, dbapi.loadDeviceByOrigin, groups, serial)
    })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockDeviceByOrigin
  , 10
  , Math.random() * 500 + 50)
}

dbapi.addOriginGroupDevice = function(group, serial) {
  return db
    .run(r.table('groups')
    .get<GroupDocument>(group.id)
    .update({devices: r.row('devices').setInsert(serial)}))
    .then(function() {
      return dbapi.getGroup(group.id)
    })
}

dbapi.removeOriginGroupDevice = function(group, serial) {
  return db
    .run(r.table('groups')
    .get<GroupDocument>(group.id)
    .update({devices: r.row('devices').setDifference([serial])}))
    .then(function() {
      return dbapi.getGroup(group.id)
    })
}

dbapi.addGroupDevices = function(group, serials) {
  const duration = apiutil.computeDuration(group, serials.length)

  return dbapi.updateUserGroupDuration(group.owner.email, group.duration, duration)
    .then(function(stats) {
      if (stats.replaced) {
        return dbapi.updateGroup(
          group.id
        , {
            duration: duration
          , devices: _.union(group.devices, serials)
          })
      }
      return Promise.reject('quota is reached')
    })
}

dbapi.removeGroupDevices = function(group, serials) {
  const duration = apiutil.computeDuration(group, -serials.length)

  return dbapi.updateUserGroupDuration(group.owner.email, group.duration, duration)
    .then(function() {
      return dbapi.updateGroup(
        group.id
      , {
          duration: duration
        , devices: _.difference(group.devices, serials)
        })
    })
}

function setLockOnDevice(serial: string, state: boolean) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {lock:
    r.branch(
      r.row('group')('lock').eq(!state)
    , state
    , r.row('group')('lock'))
  }}))
}

dbapi.lockDevice = function(serial) {
  return setLockOnDevice(serial, true)
}

dbapi.unlockDevice = function(serial) {
  return setLockOnDevice(serial, false)
}

function setLockOnUser(email: string, state: boolean) {
  return db.run(r.table('users').get<UserDocument>(email).update({groups: {lock:
    r.branch(
      r.row('groups')('lock').eq(!state)
    , state
    , r.row('groups')('lock'))
  }}, {returnChanges: true}))
}

dbapi.lockUser = function(email) {
  function wrappedlockUser() {
    return setLockOnUser(email, true)
      .then(function(stats) {
        return apiutil.lockResult(stats)
      })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockUser
  , 10
  , Math.random() * 500 + 50)
}

dbapi.unlockUser = function(email) {
  return setLockOnUser(email, false)
}

dbapi.lockGroupByOwner = function(email, id) {
  function wrappedlockGroupByOwner() {
    return dbapi.getRootGroup().then(function(group) {
      return db.run(r.table('groups').get<GroupDocument>(id).update({lock: {user:
        r.branch(
          r.row('lock')('admin')
           .eq(false)
           .and(r.row('lock')('user').eq(false))
           .and(r.row('owner')('email')
                 .eq(email)
                 .or(r.expr(email)
                      .eq(group.owner.email)))
        , true
        , r.row('lock')('user'))
      }}, {returnChanges: true}))
    })
    .then(function(stats) {
      const result = apiutil.lockResult(stats)

      if (!result.status) {
        return dbapi.getGroupAsOwnerOrAdmin(email, id).then(function(group) {
          if (!group) {
            result.data.locked = false
            result.status = true
          }
          return result
        })
      }
      return result
    })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockGroupByOwner
  , 10
  , Math.random() * 500 + 50)
}

dbapi.lockGroup = function(id) {
  function wrappedlockGroup() {
    return db.run(r.table('groups').get<GroupDocument>(id).update({lock: {user:
      r.branch(
        r.row('lock')('admin')
         .eq(false)
         .and(r.row('lock')('user')
               .eq(false))
      , true
      , r.row('lock')('user'))
    }}))
    .then(function(stats) {
      return apiutil.lockResult(stats)
    })
  }

  return apiutil.setIntervalWrapper(
    wrappedlockGroup
  , 10
  , Math.random() * 500 + 50)
}

dbapi.unlockGroup = function(id) {
  return db.run(r.table('groups').get<GroupDocument>(id).update({lock: {user: false}}))
}

dbapi.adminLockGroup = function(id, lock) {
  function wrappedAdminLockGroup() {
    return db
      .run(r.table('groups')
      .get<GroupDocument>(id)
      .update({lock: {user: true, admin: true}}, {returnChanges: true}))
      .then(function(stats) {
        const result: {status?: boolean, data?: true} = {}

        if (stats.replaced) {
          result.status =
            stats.changes![0]!.new_val.lock.admin && !stats.changes![0]!.old_val.lock.user
          if (result.status) {
            result.data = true
            lock.group = stats.changes![0]!.new_val
          }
        }
        else if (stats.skipped) {
          result.status = true
        }
        return result
      })
  }

  return apiutil.setIntervalWrapper(
    wrappedAdminLockGroup
  , 10
  , Math.random() * 500 + 50)
}

dbapi.adminUnlockGroup = function(lock) {
  if (lock.group) {
    return db
      .run(r.table('groups')
      .get<GroupDocument>(lock.group.id)
      .update({lock: {user: false, admin: false}}))
  }
  return true
}

dbapi.getRootGroup = function() {
  return dbapi.getGroupByIndex(apiutil.ROOT, 'privilege').then(function(group) {
    if (!group) {
      throw new Error('Root group not found')
    }
    return group
  })
}

dbapi.getUserGroup = function(email, id) {
  return db.run(r.table('groups').getAll(id).filter(function(group) {
    return group('users').contains(email)
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
  .then(function(groups) {
    return groups[0]
  })
}

dbapi.getUserGroups = function(email) {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('users').contains(email)
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getOnlyUserGroups = function(email) {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('owner')('email')
        .ne(email)
        .and(group('users').contains(email))
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getTransientGroups = function() {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('class')
        .ne(apiutil.BOOKABLE)
        .and(group('class').ne(apiutil.STANDARD))
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getDeviceTransientGroups = function(serial) {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('class')
        .ne(apiutil.BOOKABLE)
        .and(group('class').ne(apiutil.STANDARD))
        .and(group('devices').contains(serial))
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.isDeviceBooked = function(serial) {
  return dbapi.getDeviceTransientGroups(serial)
    .then(function(groups) {
      return groups.length > 0
    })
}

dbapi.isRemoveGroupUserAllowed = function(email, targetGroup) {
  if (targetGroup.class !== apiutil.BOOKABLE) {
    return Promise.resolve(true)
  }
  return db.run(
    r.table('groups')
     .getAll(email, {index: 'owner'})
     .filter(function(group) {
       return group('class')
         .ne(apiutil.BOOKABLE)
         .and(group('class').ne(apiutil.STANDARD))
         .and(r.expr(targetGroup.devices)
           .setIntersection(group('devices'))
           .isEmpty()
           .not())
      }))
    .then(function(cursor) {
      return cursor.toArray()
    })
    .then(function(groups) {
      return groups.length === 0
    })
}

dbapi.isUpdateDeviceOriginGroupAllowed = function(serial, targetGroup) {
  return dbapi.getDeviceTransientGroups(serial)
    .then(function(groups) {
      if (groups.length) {
        if (targetGroup.class === apiutil.STANDARD) {
          return false
        }
        for (const group of groups) {
          if (targetGroup.users.indexOf(group.owner.email) < 0) {
            return false
          }
        }
      }
      return true
    })
}

dbapi.getDeviceGroups = function(serial) {
  return db
    .run(r.table('groups')
    .filter(function(group) {
      return group('devices').contains(serial)
    }))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.getGroupAsOwnerOrAdmin = function(email, id) {
  return dbapi.getGroup(id).then(function(group) {
    if (group) {
      if (email === group.owner.email) {
        return group
      }
      return dbapi.loadUser(email).then(function(user) {
        if (user && user.privilege === apiutil.ADMIN) {
          return group
        }
        return false
      })
    }
    return false
  })
}

dbapi.getOwnerGroups = function(email) {
  return dbapi.getRootGroup().then(function(group) {
    if (email === group.owner.email) {
      return dbapi.getGroups()
    }
    return dbapi.getGroupsByIndex(email, 'owner')
  })
}

dbapi.createGroup = function(data) {
  const id = util.format('%s', uuid.v4()).replace(/-/g, '')

  return db.run(r.table('groups').insert(
    Object.assign(data, {
      id: id
    , users: _.union(data.users, [data.owner.email])
    , devices: []
    , createdAt: r.now()
    , lock: {
        user: false
      , admin: false
      }
    , ticket: null
    })))
    .then(function() {
      return dbapi.getGroup(id) as Promise<GroupDocument>
    })
}

dbapi.createUserGroup = function(data) {
  return dbapi.reserveUserGroupInstance(data.owner.email).then<CreatedUserGroup>(function(stats) {
    if (stats.replaced) {
      return dbapi.getRootGroup().then(function(rootGroup) {
        data.users = [rootGroup.owner.email]
        return dbapi.createGroup(data).then(function(group) {
          return Promise.all([
            dbapi.addGroupUser(group.id, group.owner.email)
          , dbapi.addGroupUser(group.id, rootGroup.owner.email)
          ])
          .then(function() {
            return dbapi.getGroup(group.id)
          })
        })
      })
    }
    return false
  })
}

dbapi.updateGroup = function(id, data) {
  return db.run(r.table('groups').get<GroupDocument>(id).update(data))
    .then(function() {
      return dbapi.getGroup(id)
    })
}

dbapi.reserveUserGroupInstance = function(email) {
  return db.run(r.table('users').get<UserDocument>(email)
    .update({groups: {quotas: {consumed: {number:
      r.branch(
        r.row('groups')('quotas')('consumed')('number')
         .add(1)
         .le(r.row('groups')('quotas')('allocated')('number'))
      , r.row('groups')('quotas')('consumed')('number')
         .add(1)
      , r.row('groups')('quotas')('consumed')('number'))
    }}}})
  )
}

dbapi.releaseUserGroupInstance = function(email) {
  return db.run(r.table('users').get<UserDocument>(email)
    .update({groups: {quotas: {consumed: {number:
      r.branch(
        r.row('groups')('quotas')('consumed')('number').ge(1)
      , r.row('groups')('quotas')('consumed')('number').sub(1)
      , r.row('groups')('quotas')('consumed')('number'))
    }}}})
  )
}

dbapi.updateUserGroupDuration = function(email, oldDuration, newDuration) {
  return db.run(r.table('users').get<UserDocument>(email)
    .update({groups: {quotas: {consumed: {duration:
      r.branch(
        r.row('groups')('quotas')('consumed')('duration')
         .sub(oldDuration).add(newDuration)
         .le(r.row('groups')('quotas')('allocated')('duration'))
      , r.row('groups')('quotas')('consumed')('duration')
         .sub(oldDuration).add(newDuration)
      , r.row('groups')('quotas')('consumed')('duration'))
    }}}})
  )
}

dbapi.updateUserGroupsQuotas = function(email, duration, number, repetitions) {
  return db
    .run(r.table('users').get<UserDocument>(email)
    .update({groups: {quotas: {allocated: {
      duration:
        r.branch(
          r.expr(duration)
           .ne(null)
           .and(r.row('groups')('quotas')('consumed')('duration')
             .le(duration))
           .and(r.expr(number)
             .eq(null)
             .or(r.row('groups')('quotas')('consumed')('number')
               .le(number)))
        , duration
        , r.row('groups')('quotas')('allocated')('duration'))
    , number:
        r.branch(
          r.expr(number)
            .ne(null)
            .and(r.row('groups')('quotas')('consumed')('number')
              .le(number))
            .and(r.expr(duration)
              .eq(null)
              .or(r.row('groups')('quotas')('consumed')('duration')
                .le(duration)))
        , number
        , r.row('groups')('quotas')('allocated')('number'))
    }
    , repetitions:
        r.branch(
          r.expr(repetitions).ne(null)
        , repetitions
        , r.row('groups')('quotas')('repetitions'))
    }}}, {returnChanges: true}))
}

dbapi.updateDefaultUserGroupsQuotas = function(email, duration, number, repetitions) {
  return db.run(r.table('users').get<UserDocument>(email)
    .update({groups: {quotas: {
      defaultGroupsDuration:
        r.branch(
          r.expr(duration).ne(null)
        , duration
        , r.row('groups')('quotas')('defaultGroupsDuration'))
    , defaultGroupsNumber:
        r.branch(
          r.expr(number).ne(null)
        , number
        , r.row('groups')('quotas')('defaultGroupsNumber'))
    , defaultGroupsRepetitions:
        r.branch(
          r.expr(repetitions).ne(null)
        , repetitions
        , r.row('groups')('quotas')('defaultGroupsRepetitions'))
    }}}, {returnChanges: true}))
}

dbapi.updateDeviceGroupName = function(serial, group) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {
    name:
      r.branch(
        r.expr(apiutil.isOriginGroup(group.class)).eq(false)
      , r.branch(
          r.expr(group.isActive).eq(true)
        , group.name
        , r.row('group')('name')
        )
      , r.branch(
          r.row('group')('origin').eq(r.row('group')('id'))
        , group.name
        , r.row('group')('name')
        )
      )
  , originName:
      r.branch(
        r.expr(apiutil.isOriginGroup(group.class)).eq(true)
      , group.name
      , r.row('group')('originName')
      )
  }}))
}

dbapi.updateDeviceCurrentGroupFromOrigin = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial)).then(function(device) {
    return db.run(r.table('groups').get<GroupDocument>(device!.group.origin)).then(function(group) {
      return db.run(r.table('devices').get<DeviceDocument>(serial).update({group: {
        id: r.row('group')('origin')
      , name: r.row('group')('originName')
      , owner: group!.owner
      , lifeTime: group!.dates[0]
      , class: group!.class
      , repetitions: group!.repetitions
      }}))
    })
  })
}

dbapi.askUpdateDeviceOriginGroup = function(serial, group, signature) {
   return db.run(r.table('groups').get<GroupDocument>(group.id)
     .update({ticket: {
       serial: serial
     , signature: signature
     }})
   )
}

dbapi.updateDeviceOriginGroup = function(serial, group) {
  return db.run(r.table('devices').get<DeviceDocument>(serial)
    .update({group: {
       origin: group.id
     , originName: group.name
     , id: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.id
       , r.row('group')('id'))
     , name: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.name
       , r.row('group')('name'))
     , owner: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.owner
       , r.row('group')('owner'))
     , lifeTime: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.dates[0]
       , r.row('group')('lifeTime'))
     , class: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.class
       , r.row('group')('class'))
     , repetitions: r.branch(
         r.row('group')('id').eq(r.row('group')('origin'))
       , group.repetitions
       , r.row('group')('repetitions'))
    }})
  )
  .then(function() {
    return db.run(r.table('devices').get<DeviceDocument>(serial))
  })
}

dbapi.updateDeviceCurrentGroup = function(serial, group) {
  return db.run(r.table('devices').get<DeviceDocument>(serial)
    .update({group: {
      id: group.id
    , name: group.name
    , owner: group.owner
    , lifeTime: group.dates[0]
    , class: group.class
    , repetitions: group.repetitions
    }})
  )
}

dbapi.updateUserGroup = function(group, data) {
  return dbapi.updateUserGroupDuration(group.owner.email, group.duration, data.duration)
    .then<GroupDocument | null | false>(function(stats) {
      if (stats.replaced || stats.unchanged && group.duration === data.duration) {
        return dbapi.updateGroup(group.id, data)
      }
      return false
    })
}

dbapi.deleteGroup = function(id) {
  return db.run(r.table('groups').get<GroupDocument>(id).delete())
}

dbapi.deleteUserGroup = function(id) {
  function deleteUserGroup(group: GroupDocument): Promise<'deleted'> {
    return dbapi.deleteGroup(group.id)
      .then(function() {
        return Promise.map(group.users, function(email) {
          return dbapi.removeGroupUser(group.id, email)
        })
      })
      .then(function() {
        return dbapi.releaseUserGroupInstance(group.owner.email)
      })
      .then(function() {
        return dbapi.updateUserGroupDuration(group.owner.email, group.duration, 0)
      })
      .then(function() {
        return 'deleted'
      })
  }

  return dbapi.getGroup(id).then<'deleted' | 'forbidden'>(function(group) {
    if (group!.privilege !== apiutil.ROOT) {
      return deleteUserGroup(group!)
    }
    return 'forbidden'
  })
}

dbapi.createUser = function(email, name, ip) {
  return dbapi.getRootGroup().then(function(group) {
    return dbapi.loadUser(group.owner.email).then(function(adminUser) {
      return db.run(r.table('users').insert({
        email: email
      , name: name
      , ip: ip
      , group: wireutil.makePrivateChannel()
      , lastLoggedInAt: r.now()
      , createdAt: r.now()
      , forwards: []
      , settings: {}
      , privilege: adminUser ? apiutil.USER : apiutil.ADMIN
      , groups: {
          subscribed: []
        , lock: false
        , quotas: {
            allocated: {
              number: adminUser ?
                adminUser.groups.quotas.defaultGroupsNumber :
                group.envUserGroupsNumber
            , duration: adminUser ?
                adminUser.groups.quotas.defaultGroupsDuration :
                group.envUserGroupsDuration
            }
          , consumed: {
              number: 0
            , duration: 0
            }
          , defaultGroupsNumber: adminUser ? 0 : group.envUserGroupsNumber
          , defaultGroupsDuration: adminUser ? 0 : group.envUserGroupsDuration
          , defaultGroupsRepetitions: adminUser ? 0 : group.envUserGroupsRepetitions
          , repetitions: adminUser ?
              adminUser.groups.quotas.defaultGroupsRepetitions :
              group.envUserGroupsRepetitions
          }
        }
      }, {returnChanges: true}))
      .then(function(stats) {
        if (stats.inserted) {
          return dbapi.addGroupUser(group.id, email).then(function() {
            return dbapi.loadUser(email).then(function(user) {
              stats.changes![0]!.new_val = user
              return stats
            })
          })
        }
        return stats
      })
    })
  })
}

dbapi.checkUserBeforeLogin = function(user) {
  return db.run(r.table('users').get<UserDocument>(user.email)).then(function(oldUser) {
    if (!oldUser || oldUser.name === user.name) {
      return true
    }
    return false
  })
}

dbapi.saveUserAfterLogin = function(user) {
  return db.run(r.table('users').get<UserDocument>(user.email)).then(function(oldUser) {
    if (!oldUser) {
      return dbapi.createUser(user.email, user.name, user.ip)
    }
    if (oldUser.name !== user.name) {
      return null
    }
    return db.run(r.table('users').get<UserDocument>(user.email).update({
      ip: user.ip
    , lastLoggedInAt: r.now()
    }, {returnChanges: true}))
  })
}

dbapi.loadUser = function(email) {
  return db.run(r.table('users').get<UserDocument>(email))
}

dbapi.updateUsersAlertMessage = function(alertMessage) {
  return dbapi.getRootGroup().then(function(group) {
    return db.run(r.table('users').get<UserDocument>(group.owner.email).update({settings: {
      alertMessage:
        r.branch(
          r.row.hasFields({settings: 'alertMessage'})
        , r.row('settings')('alertMessage').merge(alertMessage)
        , alertMessage
        )
    }}, {returnChanges: true}))
  })
}

dbapi.updateUserSettings = function(email, changes) {
  return db.run(r.table('users').get<UserDocument>(email).update({
    settings: changes
  }))
}

dbapi.resetUserSettings = function(email) {
  return db.run(r.table('users').get<UserDocument>(email).update({
    settings: r.literal({})
  }))
}

dbapi.insertUserAdbKey = function(email, key) {
  var entry: AdbKey = {
    title: key.title
  , fingerprint: key.fingerprint
  }

  // The full key lets a device accept the user's adb signature outright. Entries added before it
  // was kept have only the fingerprint, and get it filled in by setUserAdbPublicKey.
  if (key.publicKey) {
    entry.publicKey = key.publicKey
  }

  return db.run(r.table('users').get<UserDocument>(email).update({
    adbKeys: r.row('adbKeys').default([]).append(entry)
  }))
}

dbapi.setUserAdbPublicKey = function(fingerprint, publicKey) {
  return db.run(r.table('users').getAll(fingerprint, {
    index: 'adbKeys'
  }).update(function(user) {
    return {
      adbKeys: user('adbKeys').map(function(key) {
        return r.branch(
          key('fingerprint').eq(fingerprint)
        , key.merge({publicKey: publicKey})
        , key
        )
      })
    }
  }))
}

dbapi.loadUserAdbPublicKeys = function(email) {
  return db.run((r.table('users').get<UserDocument>(email) as UserExpression)('adbKeys').default([])
    .filter(function(key) {
      return key.hasFields('publicKey')
    })('publicKey'))
}

dbapi.deleteUserAdbKey = function(email, fingerprint) {
  return db.run(r.table('users').get<UserDocument>(email).update({
    adbKeys: r.row('adbKeys').default([]).filter(function(key) {
      return key('fingerprint').ne(fingerprint)
    })
  }))
}

dbapi.lookupUsersByAdbKey = function(fingerprint) {
  return db.run(r.table('users').getAll(fingerprint, {
    index: 'adbKeys'
  }))
}

dbapi.lookupUserByAdbFingerprint = function(fingerprint) {
  return db.run(r.table('users').getAll(fingerprint, {
      index: 'adbKeys'
    })
    .pluck('email', 'name', 'group'))
    .then(function(cursor) {
      return cursor.toArray()
    })
    .then(function(groups) {
      switch (groups.length) {
        case 1:
          return groups[0]
        case 0:
          return null
        default:
          throw new Error('Found multiple users for same ADB fingerprint')
      }
    })
}

dbapi.lookupUserByVncAuthResponse = function(response, serial) {
  return db.run(r.table('vncauth').getAll([response, serial], {
      index: 'responsePerDevice'
    })
    .eqJoin('userId', r.table('users'))('right')
    .pluck('email', 'name', 'group'))
    .then(function(cursor) {
      return cursor.toArray()
    })
    .then(function(groups) {
      switch (groups.length) {
        case 1:
          return groups[0]
        case 0:
          return null
        default:
          throw new Error('Found multiple users with the same VNC response')
      }
    })
}

dbapi.loadUserDevices = function(email) {
  return db.run((r.table('users').get<UserDocument>(email) as UserExpression).getField('groups'))
    .then(function(groups) {
      return db.run(r.table('devices').filter(function(device) {
        return r.expr(groups.subscribed)
          .contains(device('group')('id'))
          .and(device('owner')('email').eq(email))
          .and(device('present').eq(true))
      }))
    })
}

dbapi.saveDeviceLog = function(serial, entry) {
  return db.run(r.table('logs').insert({
      serial: serial
    , timestamp: r.epochTime(entry.timestamp)
    , priority: entry.priority
    , tag: entry.tag
    , pid: entry.pid
    , message: entry.message
    }
  , {
      durability: 'soft'
    }))
}

dbapi.saveDeviceInitialState = function(serial, device) {
  var data: InitialDeviceRow = {
    present: true
  , presenceChangedAt: r.now()
  , provider: device.provider
  , owner: null
  , status: device.status
  , statusChangedAt: r.now()
  , statusTimeStamp: device.statusTimeStamp
  , ready: false
  , reverseForwards: []
  , remoteConnect: false
  , remoteConnectUrl: null
  , usage: null
  , logs_enabled: false
  }
  return db.run(r.table('devices').get(serial).update(data)).then<unknown>(function(stats) {
    if (stats.skipped) {
      return dbapi.getRootGroup().then(function(group) {
        data.serial = serial
        data.createdAt = r.now()
        data.group = {
          id: group.id
        , name: group.name
        , lifeTime: group.dates[0]!
        , owner: group.owner
        , origin: group.id
        , class: group.class
        , repetitions: group.repetitions
        , originName: group.name
        , lock: false
        }
        return db.run(r.table('devices').insert(data)).then(function() {
          return dbapi.addOriginGroupDevice(group, serial)
        })
      })
    }
    return true
  })
  .then(function() {
    return db.run(r.table('devices').get<DeviceDocument>(serial))
  })
}

dbapi.setDeviceConnectUrl = function(serial, url) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    remoteConnectUrl: url
  , remoteConnect: true
  }))
}

dbapi.unsetDeviceConnectUrl = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    remoteConnectUrl: null
  , remoteConnect: false
  }))
}

dbapi.saveDeviceStatus = function(serial, status, statusTimeStamp) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    status:
      r.branch(
        r.expr(statusTimeStamp).gt(r.row('statusTimeStamp'))
      , status
      , r.row('status')
      )
  , statusChangedAt:
      r.branch(
        r.expr(statusTimeStamp).gt(r.row('statusTimeStamp'))
      , r.now()
      , r.row('statusChangedAt')
      )
  , statusTimeStamp:
      r.branch(
        r.expr(statusTimeStamp).gt(r.row('statusTimeStamp'))
      , statusTimeStamp
      , r.row('statusTimeStamp')
      )
  }))
}

dbapi.setDeviceOwner = function(serial, owner) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    owner: owner
    // Taking a device supersedes any claim on it, so a reboot that never happened cannot hand it
    // back to an earlier user later
  , restoreOwner: null
  }))
}

dbapi.unsetDeviceOwner = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    owner: null
  }))
}

// Snapshots the current owner so it can be handed back if the device returns before expiresAt.
// Writing only, never clearing: a device that has already left fires this again when its old
// worker retires, by which time the row is unowned and a clear would drop the live claim.
dbapi.reserveDeviceOwner = function(serial) {
  var expiresAt = Date.now() + deviceutil.OWNER_CLAIM_TIMEOUT

  return db.run(r.table('devices').get<DeviceDocument>(serial).update(function(device) {
    return r.branch(
      device('owner').default(null).eq(null)
    , {}
    , {restoreOwner: {
          email: device('owner')('email')
        , usage: device('usage').default(null)
        , expiresAt: expiresAt
        }
      }
    )
  }))
}

dbapi.clearDeviceRestoreOwner = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    restoreOwner: null
  }))
}

dbapi.setDevicePresent = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    present: true
  , presenceChangedAt: r.now()
  }))
}

dbapi.setDeviceAbsent = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    present: false
  , presenceChangedAt: r.now()
  }))
}

dbapi.setDeviceUsage = function(serial, usage) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    usage: usage
  , usageChangedAt: r.now()
  }))
}

dbapi.unsetDeviceUsage = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    usage: null
  , usageChangedAt: r.now()
  , logs_enabled: false
  }))
}

dbapi.setDeviceAirplaneMode = function(serial, enabled) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    airplaneMode: enabled
  }))
}

dbapi.setDeviceBattery = function(serial, battery) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      battery: {
        status: battery.status
      , health: battery.health
      , source: battery.source
      , level: battery.level
      , scale: battery.scale
      , temp: battery.temp
      , voltage: battery.voltage
      }
    }
  , {
      durability: 'soft'
    }))
}

dbapi.setDeviceBrowser = function(serial, browser) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    browser: {
      selected: browser.selected
    , apps: browser.apps
    }
  }))
}

dbapi.setDeviceConnectivity = function(serial, connectivity) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    network: {
      connected: connectivity.connected
    , type: connectivity.type
    , subtype: connectivity.subtype
    , failover: !!connectivity.failover
    , roaming: !!connectivity.roaming
    }
  }))
}

dbapi.setDevicePhoneState = function(serial, state) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    network: {
      state: state.state
    , manual: state.manual
    , operator: state.operator
    }
  }))
}

dbapi.setDeviceRotation = function(serial, rotation) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    display: {
      rotation: rotation
    }
  }))
}

dbapi.setDeviceNote = function(serial, note) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    notes: note
  }))
}

dbapi.setDeviceReverseForwards = function(serial, forwards) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    reverseForwards: forwards
  }))
}

// Returns the row it wrote, so the caller can settle a pending owner claim without reading it back
dbapi.setDeviceReady = function(serial, channel) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    channel: channel
  , ready: true
  , owner: null
  , reverseForwards: []
  }, {returnChanges: 'always'}))
}

dbapi.saveDeviceIdentity = function(serial, identity) {
  return db.run(r.table('devices').get<DeviceDocument>(serial).update({
    platform: identity.platform
  , manufacturer: identity.manufacturer
  , operator: identity.operator
  , model: identity.model
  , version: identity.version
  , abi: identity.abi
  , sdk: identity.sdk
  , display: identity.display
  , phone: identity.phone
  , product: identity.product
  , cpuPlatform: identity.cpuPlatform
  , openGLESVersion: identity.openGLESVersion
  , marketName: identity.marketName
  }))
}

// Returns every device, whatever its group; reserved to privileged (admin) operations
dbapi.getDevices = function() {
  return db.run(r.table('devices'))
    .then(function(cursor) {
      return cursor.toArray()
    })
}

dbapi.loadDevices = function(groups) {
  return db.run(r.table('devices').filter(function(device) {
    return r.expr(groups).contains(device('group')('id'))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadDevicesByOrigin = function(groups) {
  return db.run(r.table('devices').filter(function(device) {
    return r.expr(groups).contains(device('group')('origin'))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadBookableDevices = function(groups) {
  return db.run(r.table('devices').filter(function(device) {
    return r.expr(groups)
      .contains(device('group')('origin'))
      .and(device('group')('class').ne(apiutil.STANDARD))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadStandardDevices = function(groups) {
  return db.run(r.table('devices').filter(function(device) {
    return r.expr(groups)
      .contains(device('group')('origin'))
      .and(device('group')('class').eq(apiutil.STANDARD))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadPresentDevices = function() {
  return db.run(r.table('devices').getAll(true, {
    index: 'present'
  }))
}

dbapi.loadDeviceBySerial = function(serial) {
  return db.run(r.table('devices').get<DeviceDocument>(serial))
}

dbapi.loadDevice = function(groups, serial) {
  return db.run(r.table('devices').getAll(serial).filter(function(device) {
    return r.expr(groups).contains(device('group')('id'))
  }))
}

dbapi.loadBookableDevice = function(groups, serial) {
  return db.run(r.table('devices').getAll(serial).filter(function(device) {
    return r.expr(groups)
      .contains(device('group')('origin'))
      .and(device('group')('class').ne(apiutil.STANDARD))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadDeviceByCurrent = function(groups, serial) {
  return db.run(r.table('devices').getAll(serial).filter(function(device) {
    return r.expr(groups).contains(device('group')('id'))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.loadDeviceByOrigin = function(groups, serial) {
  return db.run(r.table('devices').getAll(serial).filter(function(device) {
    return r.expr(groups).contains(device('group')('origin'))
  }))
  .then(function(cursor) {
    return cursor.toArray()
  })
}

dbapi.saveUserAccessToken = function(email, token) {
  return db.run(r.table('accessTokens').insert({
    email: email
  , id: token.id
  , title: token.title
  , jwt: token.jwt
  }, {returnChanges: true}))
}

dbapi.removeUserAccessTokens = function(email) {
  return db.run(r.table('accessTokens').getAll(email, {
    index: 'email'
  }).delete())
}

dbapi.removeUserAccessToken = function(email, title) {
  return db.run(r.table('accessTokens').getAll(email, {
    index: 'email'
  }).filter({title: title}).delete())
}

dbapi.removeAccessToken = function(id) {
  return db.run(r.table('accessTokens').get<AccessTokenDocument>(id).delete())
}

dbapi.loadAccessTokens = function(email) {
  return db.run(r.table('accessTokens').getAll(email, {
    index: 'email'
  }))
}

dbapi.loadAccessToken = function(id) {
  return db.run(r.table('accessTokens').get<AccessTokenDocument>(id))
}

export default dbapi
