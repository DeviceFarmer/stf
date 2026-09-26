/**
* Copyright © 2019-2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import wirerouter from '../../../wire/router.js'
import _ from 'lodash'
import r from 'rethinkdb'
import util from 'util'
import * as uuid from 'uuid'
import logger from '../../../util/logger.js'
import timeutil from '../../../util/timeutil.js'
import wireutil from '../../../wire/util.js'
import wire from '../../../wire/index.js'
import dbapi from '../../../db/api.js'
import db from '../../../db/index.js'
import lifecycle from '../../../util/lifecycle.js'
import type {EventEmitter} from 'events'
import type {Socket} from 'zeromq/v5-compat.js'
import type {
  DeviceDocument
, DeviceGroup
, DeviceNetwork
, DeviceOwner
, GroupDates
, GroupDocument
} from '../../../types/stf.js'
import type {
  DeviceDisplayMessageFields
, DeviceField
, DevicePhoneMessageFields
} from '../../../types/wire.js'
import type {ChangeRow} from '../../../types/groups-engine.js'

type WatchedDeviceGroup = Pick<
  DeviceGroup
, 'id' | 'name' | 'origin' | 'originName' | 'lifeTime' | 'owner'
>

type WatchedDevice = Pick<
  DeviceDocument
, 'serial' | 'channel' | 'owner' | 'model' | 'operator' | 'manufacturer' | 'version' | 'sdk'
  | 'abi' | 'cpuPlatform' | 'openGLESVersion' | 'marketName'
> & {
  group: WatchedDeviceGroup
  provider: Pick<DeviceDocument['provider'], 'name'>
  network?: Pick<DeviceNetwork, 'type' | 'subtype'>
  display?: Pick<Partial<DeviceDisplayMessageFields>, 'height' | 'width'>
  phone?: Pick<DevicePhoneMessageFields, 'imei'>
}

type PublishedDevice = Omit<WatchedDevice, 'channel' | 'owner' | 'group'> & {
  channel?: string
  owner?: DeviceOwner | null
  group: Omit<WatchedDeviceGroup, 'lifeTime'> & {lifeTime?: GroupDates}
}

export default function(push: Socket, pushdev: Socket, channelRouter: EventEmitter) {
  const log = logger.createLogger('watcher-devices')

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

  function sendDeviceGroupChange(
    id: string
  , group: GroupDocument
  , serial: string
  , originName: string) {
    pushdev.send([
      wireutil.global
    , wireutil.envelope(
        new wire.DeviceGroupChangeMessage(
          id
        , new wire.DeviceGroupMessage(
            group.id
          , group.name
          , new wire.DeviceGroupOwnerMessage(
              group.owner.email
            , group.owner.name
            )
          , new wire.DeviceGroupLifetimeMessage(
              group.dates[0]!.start.getTime()
            , group.dates[0]!.stop.getTime()
            )
          , group.class
          , group.repetitions
          , originName
          )
        , serial
        )
      )
    ])
  }

  function sendDeviceChange(device1: WatchedDevice, device2: WatchedDevice, action: string) {
    function publishDevice() {
      const device: PublishedDevice = _.cloneDeep(device1)

      delete device.channel
      delete device.owner
      delete device.group.lifeTime
      return device
    }

    pushdev.send([
      wireutil.global
    , wireutil.envelope(
        new wire.DeviceChangeMessage(
          publishDevice() as unknown as DeviceField
        , action
        , device2.group.origin
        , timeutil.now('nano')
        )
      )
    ])
  }

  function sendReleaseDeviceControlAndDeviceGroupChange(
    device: WatchedDevice
  , sendDeviceGroupChangeWrapper: () => void) {
    let messageListener: (channel: string | Buffer, data: Buffer) => void
    const responseTimer = setTimeout(function() {
      channelRouter.removeListener(wireutil.global, messageListener)
      sendDeviceGroupChangeWrapper()
    }, 5000)

    messageListener = wirerouter()
      .on(wire.LeaveGroupMessage, function(channel, message) {
        if (message.serial === device.serial &&
            message.owner.email === device.owner!.email) {
          clearTimeout(responseTimer)
          channelRouter.removeListener(wireutil.global, messageListener)
          sendDeviceGroupChangeWrapper()
        }
      })
      .handler()

    channelRouter.on(wireutil.global, messageListener)
    sendReleaseDeviceControl(device.serial, device.channel)
  }

  db.run(r
    .table('devices')
    .pluck(
      'serial'
    , 'channel'
    , 'owner'
    , 'model'
    , 'operator'
    , 'manufacturer'
    , {group: ['id', 'name', 'origin', 'originName', 'lifeTime', 'owner']}
    , {provider: ['name']}
    , {network: ['type', 'subtype']}
    , {display: ['height', 'width']}
    , 'version'
    , 'sdk'
    , 'abi'
    , 'cpuPlatform'
    , 'openGLESVersion'
    , {phone: ['imei']}
    , 'marketName'
    )
    .changes(), function(err, cursor) {
    if (err) {
      throw err
    }
    return cursor
  })
  .then(function(cursor) {
    cursor.each(function(err, data: ChangeRow<WatchedDevice>) {
      if (err) {
        if (lifecycle.ending) {
          return null
        }
        throw err
      }
      if (data.old_val === null) {
        return sendDeviceChange(data.new_val, data.new_val, 'created')
      }
      else if (data.new_val === null) {
        sendDeviceChange(data.old_val, data.old_val, 'deleted')
      }
      else if (data.new_val.model !== data.old_val.model ||
        data.new_val.group.origin !== data.old_val.group.origin ||
        data.new_val.operator !== data.old_val.operator ||
        data.new_val.hasOwnProperty('network') &&
        (!data.old_val.hasOwnProperty('network') ||
         data.new_val.network!.type !== data.old_val.network!.type ||
         data.new_val.network!.subtype !== data.old_val.network!.subtype
        ) ||
        data.new_val.provider.name !== data.old_val.provider.name ||
        data.new_val.group.name !== data.old_val.group.name ||
        data.new_val.group.originName !== data.old_val.group.originName) {
        sendDeviceChange(data.new_val, data.old_val, 'updated')
      }

      const isDeleted = data.new_val === null
      const id = isDeleted ? data.old_val.group.id : data.new_val.group.id

      return dbapi.getGroup(id).then(function(group) {
        function sendDeviceGroupChangeOnDeviceDeletion() {
          const fakeGroup = Object.assign({}, group)

          fakeGroup.id = util.format('%s', uuid.v4()).replace(/-/g, '')
          fakeGroup.name = 'none'
          sendDeviceGroupChange(
            group!.id
          , fakeGroup
          , data.old_val!.serial
          , data.old_val!.group.originName
          )
        }

        function sendDeviceGroupChangeOnDeviceCurrentGroupUpdating() {
          sendDeviceGroupChange(
            data.old_val!.group.id
          , group!
          , data.new_val!.serial
          , data.new_val!.group.originName
          )
        }

        if (group) {
          if (isDeleted) {
            if (data.old_val.owner) {
              sendReleaseDeviceControlAndDeviceGroupChange(
                data.old_val
              , sendDeviceGroupChangeOnDeviceDeletion
              )
              return
            }
            sendDeviceGroupChangeOnDeviceDeletion()
            return
          }

          const isChangeCurrentGroup = data.new_val.group.id !== data.old_val.group.id
          const isChangeOriginGroup = data.new_val.group.origin !== data.old_val.group.origin
          const isChangeLifeTime =
            data.new_val.group.lifeTime.start.getTime() !==
            data.old_val.group.lifeTime.start.getTime()

          if (isChangeLifeTime && !isChangeCurrentGroup && !isChangeOriginGroup) {
            sendDeviceGroupChange(
              data.old_val.group.id
            , group
            , data.new_val.serial
            , data.new_val.group.originName
            )
            return
          }

          if (isChangeCurrentGroup) {
            if (data.new_val.owner && group.users.indexOf(data.new_val.owner.email) < 0) {
              sendReleaseDeviceControlAndDeviceGroupChange(
                data.new_val
              , sendDeviceGroupChangeOnDeviceCurrentGroupUpdating
              )
            }
            else {
              sendDeviceGroupChangeOnDeviceCurrentGroupUpdating()
            }
          }

          if (isChangeOriginGroup) {
            dbapi.getGroup(data.old_val.group.origin).then(function(originGroup) {
              if (originGroup) {
                dbapi.removeOriginGroupDevice(originGroup, data.new_val.serial)
              }
            })
            dbapi.getGroup(data.new_val.group.origin).then(function(originGroup) {
              if (originGroup) {
                dbapi.addOriginGroupDevice(originGroup, data.new_val.serial)
              }
            })
            if (!isChangeCurrentGroup) {
              sendDeviceGroupChange(
                data.new_val.group.id
              , group
              , data.new_val.serial
              , data.new_val.group.originName
              )
            }
          }
        }
      })
    })
  })
  .catch(function(err) {
    log.error('An error occured during DEVICES table watching', err.stack)
  })
}
