/**
* Copyright © 2019 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import Promise from 'bluebird'
import logger from '../../../util/logger.js'
import apiutil from '../../../util/apiutil.js'
import db from '../../../db/index.js'
import dbapi from '../../../db/api.js'
import r from 'rethinkdb'
import type {GroupDocument} from '../../../types/stf.js'

type LockedUpdate = r.WriteResult | false
type LockedDeletion = r.WriteResult | 'deleted' | 'forbidden'
type Instant = Date & number

export default function() {
  const log = logger.createLogger('groups-scheduler')

  function updateOriginGroupLifetime(group: GroupDocument) {
    const lock = {}

    return dbapi.adminLockGroup(group.id, lock).then<LockedUpdate>(function(lockingSuccessed) {
      if (lockingSuccessed) {
        const now = Date.now()

        return db.run(r.table('groups').get<GroupDocument>(group.id).update({
          dates: [{
            start: new Date(now)
          , stop: new Date(now + (
            (group.dates[0]!.stop as Instant) - (group.dates[0]!.start as Instant)
          ))
          }]
        }))
      }
      return false
    })
    .finally(function() {
      return dbapi.adminUnlockGroup(lock)
    })
  }

  function deleteUserGroup(group: GroupDocument) {
    const lock = {}

    return dbapi.adminLockGroup(group.id, lock).then<LockedDeletion>(function(lockingSuccessed) {
      if (lockingSuccessed) {
        return dbapi.deleteUserGroup(group.id)
      }
      else {
        return db.run(r.table('groups').get<GroupDocument>(group.id).update({
          isActive: false
        , state: apiutil.WAITING
        }))
      }
    })
    .finally(function() {
      return dbapi.adminUnlockGroup(lock)
    })
  }

  function updateGroupDates(group: GroupDocument, incr: number, isActive: boolean) {
    const repetitions = group.repetitions - incr
    const dates = group.dates.slice(incr)
    const duration = group.devices.length * (
      (dates[0]!.stop as unknown as number) - (dates[0]!.start as unknown as number)
    ) * (repetitions + 1)

    return db.run(r.table('groups').get<GroupDocument>(group.id).update({
      dates: dates
    , repetitions: repetitions
    , duration: duration
    , isActive: isActive
    , state: apiutil.READY
    }))
    .then(function() {
      return dbapi.updateUserGroupDuration(group.owner.email, group.duration, duration)
    })
  }

  function doBecomeUnactiveGroup(group: GroupDocument) {
    const lock = {}

    return dbapi.adminLockGroup(group.id, lock).then(function(lockingSuccessed) {
      if (lockingSuccessed) {
        return updateGroupDates(group, 1, false)
      }
      else {
        return db.run(r.table('groups').get<GroupDocument>(group.id).update({
          isActive: false
        , state: apiutil.WAITING
        }))
      }
    })
    .finally(function() {
      return dbapi.adminUnlockGroup(lock)
    })
  }

  function doCleanElapsedGroupDates(group: GroupDocument, incr: string) {
    const lock = {}

    return dbapi.adminLockGroup(group.id, lock).then<LockedUpdate>(function(lockingSuccessed) {
      return lockingSuccessed ? updateGroupDates(group, incr as unknown as number, false) : false
    })
    .finally(function() {
      return dbapi.adminUnlockGroup(lock)
    })
  }

  function doBecomeActiveGroup(group: GroupDocument, incr: string) {
    const lock = {}

    return dbapi.adminLockGroup(group.id, lock).then<LockedUpdate>(function(lockingSuccessed) {
      return lockingSuccessed ? updateGroupDates(group, incr as unknown as number, true) : false
    })
    .finally(function() {
      return dbapi.adminUnlockGroup(lock)
    })
  }

  dbapi.unlockBookingObjects().then(function() {
    setInterval(function() {
      const now = Date.now()

      dbapi.getReadyGroupsOrderByIndex('startTime').then(function(groups: GroupDocument[]) {
        Promise.each(groups, (function(group) {
          if (apiutil.isOriginGroup(group.class)) {
            if (now >= group.dates[0]!.stop.getTime()) {
              return updateOriginGroupLifetime(group)
            }
          }
          else if ((group.isActive || group.state === apiutil.WAITING) &&
                   now >= group.dates[0]!.stop.getTime()) {
            if (group.dates.length === 1) {
              return deleteUserGroup(group)
            }
            else {
              return doBecomeUnactiveGroup(group)
            }
          }
          else if (!group.isActive) {
            for(const i in group.dates) {
              if (now >= group.dates[i]!.stop.getTime()) {
                if (group.dates[i]!.stop === group.dates[group.dates.length - 1]!.stop) {
                  return deleteUserGroup(group)
                }
              }
              else if (now < group.dates[i]!.start.getTime()) {
                return (i as unknown as number) > 0 ? doCleanElapsedGroupDates(group, i) : false
              }
              else {
                return doBecomeActiveGroup(group, i)
              }
            }
          }
          return false
        }))
      })
      .catch(function(err) {
        log.error('An error occured during groups scheduling', err.stack)
      })
    }, 1000)
  })
}
