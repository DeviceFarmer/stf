/**
* Copyright © 2019-2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import wirerouter from '../../../wire/router.js'
import Promise from 'bluebird'
import _ from 'lodash'
import r from 'rethinkdb'
import logger from '../../../util/logger.js'
import timeutil from '../../../util/timeutil.js'
import apiutil from '../../../util/apiutil.js'
import wireutil from '../../../wire/util.js'
import wire from '../../../wire/index.js'
import dbapi from '../../../db/api.js'
import db from '../../../db/index.js'
import lifecycle from '../../../util/lifecycle.js'
import type {EventEmitter} from 'events'
import type {Socket} from 'zeromq/v5-compat.js'
import type {GroupDates, GroupDocument, GroupRef} from '../../../types/stf.js'
import type {ChangeRow} from '../../../types/groups-engine.js'

type WatchedGroup = Pick<
  GroupDocument
, 'id' | 'name' | 'class' | 'privilege' | 'owner' | 'dates' | 'duration' | 'repetitions'
  | 'devices' | 'users' | 'state' | 'isActive' | 'ticket'
>

export default function(push: Socket, pushdev: Socket, channelRouter: EventEmitter) {
  const log = logger.createLogger('watcher-groups')

  function sendReleaseDeviceControl(serial: string, channel: string) {
    push.send([
      channel
    , wireutil.envelope(
        new wire.UngroupMessage(
          wireutil.toDeviceRequirements({
            serial: {
              value: serial
            , match: 'exact'
            }
          })
        )
      )
    ])
  }

  function sendGroupChange(
    group: WatchedGroup
  , subscribers: string[]
  , isChangedDates: boolean
  , isChangedClass: boolean
  , isAddedUser: boolean
  , users: string[]
  , isAddedDevice: boolean
  , devices: string[]
  , action: string) {
    function dates2String(dates: GroupDates[]) {
      return dates.map(function(date) {
        return {
          start: date.start.toJSON()
        , stop: date.stop.toJSON()
        }
      })
    }
    pushdev.send([
      wireutil.global
    , wireutil.envelope(
        new wire.GroupChangeMessage(
          new wire.GroupField(
            group.id
          , group.name
          , group.class
          , group.privilege
          , group.owner
          , dates2String(group.dates)
          , group.duration
          , group.repetitions
          , group.devices
          , group.users
          , group.state
          , group.isActive
          )
        , action
        , subscribers
        , isChangedDates
        , isChangedClass
        , isAddedUser
        , users
        , isAddedDevice
        , devices
        , timeutil.now('nano')
        )
      )
    ])
  }

  function sendGroupUsersChange(
    group: GroupRef
  , users: string[]
  , devices: string[]
  , isAdded: boolean
  , action: string) {
    const isDeletedLater = action === 'GroupDeletedLater'

    pushdev.send([
      wireutil.global
    , wireutil.envelope(
        new wire.GroupUserChangeMessage(users, isAdded, group.id, isDeletedLater, devices))
    ])
  }

  function doUpdateDeviceOriginGroup(group: WatchedGroup) {
    return dbapi.updateDeviceOriginGroup(
      group.ticket!.serial
    , group
    ).then(function() {
      push.send([
        wireutil.global
      , wireutil.envelope(
          new wire.DeviceOriginGroupMessage(group.ticket!.signature)
        )
      ])
    })
  }

  function doUpdateDevicesGroupName(group: WatchedGroup) {
    return Promise.map(group.devices, function(serial) {
      return dbapi.updateDeviceGroupName(serial, group)
    })
  }

  function doUpdateDevicesCurrentGroup(group: WatchedGroup, devices: string[]) {
    return Promise.map(devices, function(serial) {
      return dbapi.updateDeviceCurrentGroup(serial, group)
    })
  }

  function doUpdateDevicesCurrentGroupFromOrigin(devices: string[]) {
    return Promise.map(devices, function(serial) {
      return dbapi.updateDeviceCurrentGroupFromOrigin(serial)
    })
  }

  function doUpdateDevicesCurrentGroupDates(group: WatchedGroup) {
    if (apiutil.isOriginGroup(group.class)) {
      return Promise.map(group.devices, function(serial) {
        return dbapi.loadDeviceBySerial(serial).then<r.WriteResult[] | false>(function(device) {
          return device!.group.id === group.id ?
            doUpdateDevicesCurrentGroup(group, [serial]) :
            false
        })
      })
    }
    else {
      return Promise.map(group.devices, function(serial) {
        return doUpdateDevicesCurrentGroup(group, [serial])
      })
    }
  }

  function treatGroupUsersChange(
    group: WatchedGroup
  , users: string[]
  , isActive: boolean
  , isAddedUser: boolean) {
    if (isActive) {
      return Promise.map(users, function(email) {
        return Promise.map(group.devices, function(serial) {
          return dbapi.loadDeviceBySerial(serial).then(function(device) {
            if (device && device.group.id === group.id) {
              if (!isAddedUser && device.owner && device.owner.email === email) {
                return new Promise<string>(function(resolve) {
                  let messageListener: (channel: string | Buffer, data: Buffer) => void
                  const responseTimer = setTimeout(function() {
                    channelRouter.removeListener(wireutil.global, messageListener)
                    resolve(serial)
                  }, 5000)

                  messageListener = wirerouter()
                    .on(wire.LeaveGroupMessage, function(channel, message) {
                      if (message.serial === serial &&
                          message.owner.email === email) {
                        clearTimeout(responseTimer)
                        channelRouter.removeListener(wireutil.global, messageListener)
                        resolve(serial)
                      }
                    })
                    .handler()

                  channelRouter.on(wireutil.global, messageListener)
                  sendReleaseDeviceControl(serial, device.channel)
                })
              }
              return serial
            }
            return false
          })
        })
        .then(function(devices) {
          sendGroupUsersChange(
            group
          , [email]
          , _.without(devices, false) as string[]
          , isAddedUser
          , 'GroupUser(s)Updated')
        })
      })
    }
    else {
      return sendGroupUsersChange(group, users, [], isAddedUser, 'GroupUser(s)Updated')
    }
  }

  function treatGroupDevicesChange(
    oldGroup: WatchedGroup
  , group: WatchedGroup | null
  , devices: string[]
  , isAddedDevice: boolean) {
    if (isAddedDevice) {
      return doUpdateDevicesCurrentGroup(group!, devices)
    }
    else {
      return doUpdateDevicesCurrentGroupFromOrigin(devices)
        .then(function() {
          if (group === null) {
            sendGroupUsersChange(oldGroup, oldGroup.users, [], false, 'GroupDeletedLater')
          }
        })
    }
  }

  function treatGroupDeletion(group: WatchedGroup) {
    if (apiutil.isOriginGroup(group.class)) {
      return dbapi.getRootGroup().then(function(rootGroup) {
        return Promise.map(group.devices, function(serial) {
          return dbapi.updateDeviceOriginGroup(serial, rootGroup)
        })
        .then(function() {
          sendGroupUsersChange(group, group.users, [], false, 'GroupDeletedLater')
        })
      })
    }
    else {
      return sendGroupUsersChange(group, group.users, [], false, 'GroupDeleted')
    }
  }


  db.run(r
    .table('groups')
    .pluck(
      'id'
    , 'name'
    , 'class'
    , 'privilege'
    , 'owner'
    , 'dates'
    , 'duration'
    , 'repetitions'
    , 'devices'
    , 'users'
    , 'state'
    , 'isActive'
    , 'ticket'
    )
    .changes(), function(err, cursor) {
    if (err) {
      throw err
    }
    return cursor
  })
  .then(function(cursor) {
    cursor.each(function(err, data: ChangeRow<WatchedGroup>) {
      let users, devices, isBecomeActive, isBecomeUnactive, isActive
      , isAddedUser, isAddedDevice, isUpdatedDeviceOriginGroup, isChangedDates, isChangedName

      if (err) {
        if (lifecycle.ending) {
          return null
        }
        throw err
      }
      if (data.old_val === null) {
        sendGroupChange(
          data.new_val
        , data.new_val.users
        , false
        , false
        , false
        , []
        , false
        , []
        , 'created'
        )
        return sendGroupUsersChange(
          data.new_val
        , data.new_val.users
        , data.new_val.devices
        , true
        , 'GroupCreated'
        )
      }

      if (data.new_val === null) {
        sendGroupChange(
          data.old_val
        , data.old_val.users
        , false
        , false
        , false
        , []
        , false
        , []
        , 'deleted'
        )

        users = data.old_val.users
        devices = data.old_val.devices
        isChangedDates = false
        isActive = data.old_val.isActive
        isBecomeActive = isBecomeUnactive = false
        isAddedUser = isAddedDevice = false
        isUpdatedDeviceOriginGroup = false
        isChangedName = false
      }
      else {
        users = _.xor(data.new_val.users, data.old_val.users)
        devices = _.xor(data.new_val.devices, data.old_val.devices)
        isChangedDates =
          data.old_val.dates.length !== data.new_val.dates.length ||
          data.old_val.dates[0]!.start.getTime() !==
          data.new_val.dates[0]!.start.getTime() ||
          data.old_val.dates[0]!.stop.getTime() !==
          data.new_val.dates[0]!.stop.getTime()
        isActive = data.new_val.isActive
        isBecomeActive = !data.old_val.isActive && data.new_val.isActive
        isBecomeUnactive = data.old_val.isActive && !data.new_val.isActive
        isAddedUser = data.new_val.users.length > data.old_val.users.length
        isAddedDevice = data.new_val.devices.length > data.old_val.devices.length
        isUpdatedDeviceOriginGroup =
          data.new_val.ticket !== null &&
          (data.old_val.ticket === null ||
           data.new_val.ticket.signature !== data.old_val.ticket.signature)
        isChangedName = data.old_val.name !== data.new_val.name

        if (!isUpdatedDeviceOriginGroup) {
          sendGroupChange(
            data.new_val
          , _.union(data.old_val.users, data.new_val.users)
          , isChangedDates
          , data.old_val.class !== data.new_val.class
          , isAddedUser
          , users
          , isAddedDevice
          , devices
          , 'updated'
          )
        }
      }

      if (isUpdatedDeviceOriginGroup) {
        return doUpdateDeviceOriginGroup(data.new_val!)
      }
      else if (isBecomeActive && data.new_val!.devices.length) {
        return doUpdateDevicesCurrentGroup(data.new_val!, data.new_val!.devices)
      }
      else if (isBecomeUnactive && data.new_val!.devices.length) {
        return doUpdateDevicesCurrentGroupFromOrigin(data.new_val!.devices)
      }
      else if (devices.length && isActive && !apiutil.isOriginGroup(data.old_val.class)) {
        return treatGroupDevicesChange(data.old_val, data.new_val, devices, isAddedDevice)
      }
      else if (data.new_val === null) {
        return treatGroupDeletion(data.old_val)
      }
      else if (isChangedDates && isActive) {
        return doUpdateDevicesCurrentGroupDates(data.new_val)
      }
      else if (users.length) {
        return treatGroupUsersChange(data.old_val, users, isActive, isAddedUser)
      }
      else if (isChangedName) {
        return doUpdateDevicesGroupName(data.new_val)
      }
      return true
    })
  })
  .catch(function(err) {
    log.error('An error occured during GROUPS table watching', err.stack)
  })
}
