/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import _ from 'lodash'
import Promise from 'bluebird'
import * as uuid from 'uuid'
import adbutil from '../../../util/adbutil.js'
import dbapi from '../../../db/api.js'
import logger from '../../../util/logger.js'
import datautil from '../../../util/datautil.js'
import deviceutil from '../../../util/deviceutil.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import wirerouter from '../../../wire/router.js'

import apiutil from '../../../util/apiutil.js'
import jwtutil from '../../../util/jwtutil.js'
import type {AccessTokenDocument, DeviceDocument} from '../../../types/stf.js'
import lockutil from '../../../util/lockutil.js'
import type {Response} from 'express'
import type {
  AddUserDeviceBody
, AutomationLeaseBody
, ApiLock
, ApiRequest
, MessageListener
} from '../../../types/units-api.js'

var adb = adbutil()

var log = logger.createLogger('api:controllers:user')

function getUser(req: ApiRequest, res: Response) {
  // delete req.user.groups.lock
  res.json({
    success: true
  , description: 'User Profile'
  , user: req.user
  })
}

function getUserDevices(req: ApiRequest, res: Response) {
  var fields = req.swagger.params.fields.value

  dbapi.loadUserDevices(req.user.email)
    .then(function(cursor) {
      return Promise.promisify<DeviceDocument[]>(cursor.toArray, {context: cursor})()
        .then(function(list) {
          var deviceList: Partial<DeviceDocument>[] = []

          list.forEach(function(device) {
            datautil.normalize(device, req.user)
            var responseDevice: Partial<DeviceDocument> = device
            if (fields) {
              responseDevice = _.pick(device, fields.split(','))
            }
            deviceList.push(responseDevice)
          })

          res.json({
            success: true
          , description: 'Controlled devices information'
          , devices: deviceList
          })
        })
    })
    .catch(function(err) {
      log.error('Failed to load device list: ', err.stack)
      res.status(500).json({
        success: false
      , description: 'Internal Server Error'
      })
    })
}

// Every device endpoint below opens the same way: find a device this user can see, and refuse
// unless they are the one using it. Only the wording of the refusal differs, so the 404, the 403
// and the 500 are all the helper's to answer.
function withOwnedDevice(
  req: ApiRequest
, res: Response
, serial: string
, notOwnedMessage: string
, handler: (device: DeviceDocument) => void
, access: 'manual' | 'read' | 'automation' = 'manual'
) {
  return dbapi.loadDevice(req.user.groups.subscribed, serial)
    .then(function(cursor) {
      cursor.next(function(err: Error, device: DeviceDocument) {
        if (err || !device) {
          apiutil.respond(res, 404, 'Device not found')
          return
        }

        datautil.normalize(device, req.user)
        if (access === 'automation') {
          if (device.owner && device.owner.email !== req.user.email) {
            apiutil.respond(res, 403, notOwnedMessage)
            return
          }
          if (!device.present || !device.ready || !device.owner) {
            apiutil.respond(res, 409, 'Stale automation lease')
            return
          }
          handler(device)
          return
        }
        if (!deviceutil.isOwnedByUser(device, req.user)) {
          apiutil.respond(res, 403, notOwnedMessage)
          return
        }

        if (device.automationLeaseId && access === 'manual') {
          apiutil.respond(res, 409,
            'Device has a coordinator lease; use its fenced automation release endpoint')
          return
        }
        handler(device)
      })
    })
    .catch(function(err) {
      apiutil.internalError(res, 'Failed to load device "%s": ', serial, err.stack)
    })
}

function getUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value
  var fields = req.swagger.params.fields.value

  withOwnedDevice(req, res, serial, 'Device is not owned by you'
  , function(device) {
    var responseDevice: Partial<DeviceDocument> = device
    if (fields) {
      responseDevice = _.pick(device, fields.split(','))
    }

    return res.json({
      success: true
    , description: 'Controlled device information'
    , device: responseDevice
    })
  }, 'read')
}

function addUserDevice(req: ApiRequest<AddUserDeviceBody>, res: Response) {
  var serial = req.hasOwnProperty('body') ? req.body.serial : req.swagger.params.serial.value
  var timeout = req.hasOwnProperty('body') ? req.body.timeout ||
                                             null : req.swagger.params.timeout.value || null
  const leaseId = req.body?.leaseId || null
  const automationRunner = req.body?.automationRunner ?? null
  if (automationRunner !== null && (automationRunner !== 'maestro' || !leaseId)) {
    apiutil.respond(res, 400, 'Invalid automation runner')
    return
  }
  if (leaseId && (typeof leaseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(leaseId) ||
      (timeout !== null && (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647)))) {
    apiutil.respond(res, 400, 'Invalid automation lease ID')
    return
  }
  const lock: ApiLock = {}

  lockutil.lockGenericDevice(req, res, lock, dbapi.lockDeviceByCurrent)
    .then(function(lockingSuccessed) {
      if (lockingSuccessed) {
        const device = lock.device!

        datautil.normalize(device, req.user)
        if (!deviceutil.isAddable(device, req.user)) {
          lockutil.unlockDevice(lock)
          res.status(403).json({
            success: false
          , description: 'Device is being used or not available'
          })
          return
        }

        var messageListener: MessageListener

        // Timer will be called if no JoinGroupMessage is received till 5 seconds
        var responseTimer = setTimeout(function() {
          req.options.channelRouter.removeListener(wireutil.global, messageListener)
          lockutil.unlockDevice(lock)
          return res.status(504).json({
              success: false
            , description: 'Device is not responding'
          })
        }, automationRunner ? 15000 : 5000)

        messageListener = wirerouter()
          .on(wire.JoinGroupMessage, function(channel, message) {
            if (message.serial === serial && message.owner.email === req.user.email &&
                (message.leaseId || null) === leaseId &&
                (message.automationRunner || null) === automationRunner) {
              clearTimeout(responseTimer)
              req.options.channelRouter.removeListener(wireutil.global, messageListener)
              lockutil.unlockDevice(lock)

              res.json({
                success: true
              , description: 'Device successfully added'
              , owner: message.owner
              , deviceChannel: device.channel
              , ...(leaseId ? {leaseId} : {})
              , ...(automationRunner ? {automationRunner} : {})
              })
            }
          })
          .handler()

        req.options.channelRouter.on(wireutil.global, messageListener)
        var usage = 'automation'

        req.options.push.send([
          device.channel
        , wireutil.envelope(
            new wire.GroupMessage(
              new wire.OwnerMessage(
                req.user.email
              , req.user.name
              , req.user.group
              )
            , timeout
            , wireutil.toDeviceRequirements({
              serial: {
                value: serial
              , match: 'exact'
              }
            })
            , usage
            , leaseId
            , automationRunner
            )
          )
        ])
      }
    })
    .catch(function(err) {
      lockutil.unlockDevice(lock)
      apiutil.internalError(res, `Failed to take control of ${serial} device: `, err.stack)
    })
}

function automationLeaseOperation(
  req: ApiRequest<AutomationLeaseBody>, res: Response, action: 'renew' | 'release'
) {
  const {leaseId, timeout} = req.body || {}
  if (typeof leaseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(leaseId) ||
      (action === 'renew' &&
        (!Number.isInteger(timeout) || timeout! <= 0 || timeout! > 2147483647))) {
    apiutil.respond(res, 400, 'Invalid automation lease request')
    return
  }
  const serial = req.swagger.params.serial.value
  withOwnedDevice(req, res, serial, 'Device is not owned by you', function(device) {
    if (device.usage !== 'automation' || device.automationLeaseId !== leaseId) {
      apiutil.respond(res, 409, 'Stale automation lease')
      return
    }
    const responseChannel = 'txn_' + uuid.v4()
    const cleanup = () => {
      clearTimeout(timer)
      req.options.channelRouter.removeListener(responseChannel, listener)
      req.options.sub.unsubscribe(responseChannel)
    }
    const timer = setTimeout(() => {
      cleanup()
      apiutil.respond(res, 504, 'Device is not responding')
    }, action === 'release' ? 90000 : 5000)
    const listener = wirerouter().on(wire.TransactionDoneMessage, (_channel, message) => {
      if (message.source !== serial) {
        return
      }
      cleanup()
      if (!message.success) {
        apiutil.respond(res, 409, message.data || 'Stale automation lease')
        return
      }
      const body = message.body ? JSON.parse(message.body) : {}
      res.json({success: true, leaseId, ...body})
    }).handler()
    req.options.sub.subscribe(responseChannel)
    req.options.channelRouter.on(responseChannel, listener)
    req.options.push.send([device.channel, wireutil.transaction(responseChannel,
      new wire.AutomationLeaseMessage(serial, new wire.OwnerMessage(
        req.user.email, req.user.name, req.user.group
      ), leaseId, action, timeout)
    )])
  }, 'automation')
}

function renewAutomationLease(req: ApiRequest<AutomationLeaseBody>, res: Response) {
  return automationLeaseOperation(req, res, 'renew')
}

function releaseAutomationLease(req: ApiRequest<AutomationLeaseBody>, res: Response) {
  return automationLeaseOperation(req, res, 'release')
}

function deleteUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value
  const reservationId = req.swagger.params.reservationId?.value
  const deviceChannel = req.swagger.params.deviceChannel?.value
  if (Boolean(reservationId) !== Boolean(deviceChannel)) {
    apiutil.respond(res, 400, 'Both reservationId and deviceChannel are required')
    return
  }

  withOwnedDevice(req, res, serial, 'You cannot release this device. Not owned by you'
  , function(device) {
    if (reservationId && (device.owner?.reservationId !== reservationId ||
        device.channel !== deviceChannel)) {
      apiutil.respond(res, 409, 'Device reservation changed')
      return
    }
    var messageListener: MessageListener

    // Timer will be called if no LeaveGroupMessage is received till 5 seconds
    var responseTimer = setTimeout(function() {
      req.options.channelRouter.removeListener(wireutil.global, messageListener)
      return res.status(504).json({
          success: false
        , description: 'Device is not responding'
      })
    }, 5000)

    messageListener = wirerouter()
      .on(wire.LeaveGroupMessage, function(channel, message) {
        if (message.serial === serial &&
            (!reservationId || message.owner.reservationId === reservationId) &&
            (message.owner.email === req.user.email || req.user.privilege === 'admin')) {
          clearTimeout(responseTimer)
          req.options.channelRouter.removeListener(wireutil.global, messageListener)

          res.json({
            success: true
          , description: 'Device successfully removed'
          })
        }
      })
      .handler()

    req.options.channelRouter.on(wireutil.global, messageListener)

    req.options.push.send([
      device.channel
    , wireutil.envelope(
        new wire.UngroupMessage(
          wireutil.toDeviceRequirements({
            serial: {
              value: serial
            , match: 'exact'
            }
          })
        , reservationId
        )
      )
    ])
  })
}

function rebootUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value
  var keepOwnership = req.swagger.params.keepOwnership.value

  withOwnedDevice(req, res, serial, 'Device is not owned by you or is not available'
  , function(device) {
    // Claimed before the reboot is asked for, since the device can be gone before the next
    // write would land. Reboot itself is dispatched and not waited on: it takes the adb
    // connection with it, so the worker that would acknowledge dies first.
    Promise.resolve(keepOwnership ?
        dbapi.reserveDeviceOwner(serial) :
        null
      )
      .then(function() {
        req.options.push.send([
          device.channel
        , wireutil.envelope(new wire.RebootMessage())
        ])

        apiutil.respond(res, 200, keepOwnership ?
          'Device reboot requested, and it is being kept for you' :
          'Device reboot requested'
        )
      })
      .catch(function(err) {
        apiutil.internalError(res, 'Failed to keep device "%s" for its owner: ', serial
        , err.stack)
      })
  })
}

function remoteConnectUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  withOwnedDevice(req, res, serial, 'Device is not owned by you or is not available'
  , function(device) {
    var responseChannel = 'txn_' + uuid.v4()
    req.options.sub.subscribe(responseChannel)

    var messageListener: MessageListener

	// Timer will be called if no JoinGroupMessage is received till 5 seconds
    var timer = setTimeout(function() {
      req.options.channelRouter.removeListener(responseChannel, messageListener)
      req.options.sub.unsubscribe(responseChannel)
      return res.status(504).json({
          success: false
        , description: 'Device is not responding'
      })
    }, 5000)

    messageListener = wirerouter()
      .on(wire.ConnectStartedMessage, function(channel, message) {
        if (message.serial === serial) {
          clearTimeout(timer)
          req.options.sub.unsubscribe(responseChannel)
          req.options.channelRouter.removeListener(responseChannel, messageListener)
          res.json({
            success: true
          , description: 'Remote connection is enabled'
          , remoteConnectUrl: message.url
          })
        }
      })
      .handler()

    req.options.channelRouter.on(responseChannel, messageListener)

    dbapi.loadUserAdbPublicKeys(req.user.email)
      .catch(function(err) {
        log.error('Failed to load ADB public keys of "%s"', req.user.email, err.stack)
        return []
      })
      .then(function(adbPublicKeys) {
        req.options.push.send([
          device.channel
        , wireutil.transaction(
            responseChannel
          , new wire.ConnectStartMessage(req.user.email, adbPublicKeys)
          )
        ])
      })
  })
}

function remoteDisconnectUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  withOwnedDevice(req, res, serial, 'Device is not owned by you or is not available'
  , function(device) {
    var responseChannel = 'txn_' + uuid.v4()
    req.options.sub.subscribe(responseChannel)

    var messageListener: MessageListener

    // Timer will be called if no JoinGroupMessage is received till 5 seconds
    var timer = setTimeout(function() {
      req.options.channelRouter.removeListener(responseChannel, messageListener)
      req.options.sub.unsubscribe(responseChannel)
      return res.status(504).json({
        success: false
      , description: 'Device is not responding'
      })
    }, 5000)

    messageListener = wirerouter()
      .on(wire.ConnectStoppedMessage, function(channel, message) {
        if (message.serial === serial) {
          clearTimeout(timer)
          req.options.sub.unsubscribe(responseChannel)
          req.options.channelRouter.removeListener(responseChannel, messageListener)
          res.json({
            success: true
          , description: 'Device remote disconnected successfully'
          })
        }
      })
      .handler()

    req.options.channelRouter.on(responseChannel, messageListener)

    req.options.push.send([
      device.channel
    , wireutil.transaction(
        responseChannel
      , new wire.ConnectStopMessage()
      )
    ])
  })
}

function getUserAccessTokens(req: ApiRequest, res: Response) {
  dbapi.loadAccessTokens(req.user.email)
    .then(function(cursor) {
      return Promise.promisify<AccessTokenDocument[]>(cursor.toArray, {context: cursor})()
        .then(function(list) {
          var titles: string[] = []
          list.forEach(function(token) {
            titles.push(token.title)
          })
          res.json({
            success: true
          , titles: titles
          })
        })
    })
    .catch(function(err) {
      log.error('Failed to load tokens: ', err.stack)
      res.status(500).json({
        success: false
      })
    })
}

function addAdbPublicKey(req: ApiRequest, res: Response) {
  var data = req.swagger.params.adb.value
  Promise.resolve(adb.util.parsePublicKey(data.publickey))
    .then(function(key) {
      return dbapi.lookupUsersByAdbKey(key.fingerprint)
        .then(function(cursor) {
          return cursor.toArray()
        })
        .then(function(users) {
          return {
            key: {
              title: data.title || key.comment
            , fingerprint: key.fingerprint
            , publicKey: data.publickey.trim()
            }
          , users: users
          }
        })
    })
    .then(function(data) {
      if (data.users.length) {
        return res.json({
          success: true
        })
      }
      else {
        return dbapi.insertUserAdbKey(req.user.email, data.key)
          .then(function() {
            return res.json({
              success: true
            })
          })
      }
    })
    .then(function() {
      req.options.push.send([
        req.user.group
      , wireutil.envelope(new wire.AdbKeysUpdatedMessage())
      ])
    })
    .catch(dbapi.DuplicateSecondaryIndexError, function() {
      // No-op
      return res.json({
        success: true
      })
    }).catch(function(err) {
      log.error('Failed to insert new adb key fingerprint: ', err.stack)
      return res.status(500).json({
        success: false
      , message: 'Unable to insert new adb key fingerprint to database'
      })
    })
}

function getAccessToken(req: ApiRequest, res: Response) {
  const id = req.swagger.params.id.value

  dbapi.loadAccessToken(id).then(function(token) {
    if (!token || token.email !== req.user.email) {
      apiutil.respond(res, 404, 'Not Found (access token)')
    }
    else {
      apiutil.respond(res, 200, 'Access Token Information', {
        token: apiutil.publishAccessToken(token)
      })
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to delete access token "%s": ', id, err.stack)
  })
}

function getAccessTokens(req: ApiRequest, res: Response) {
  dbapi.loadAccessTokens(req.user.email).then(function(cursor) {
    Promise.promisify<
      AccessTokenDocument[]
    >(cursor.toArray, {context: cursor})().then(function(tokens) {
      const tokenList: Partial<AccessTokenDocument>[] = []

      tokens.forEach(function(token) {
        tokenList.push(apiutil.publishAccessToken(token))
      })
      apiutil.respond(res, 200, 'Access Tokens Information', {tokens: tokenList})
    })
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to get access tokens: ', err.stack)
  })
}

function createAccessToken(req: ApiRequest, res: Response) {
  const title = req.swagger.params.title.value
  const jwt = jwtutil.encode({
    payload: {
      email: req.user.email
    , name: req.user.name
    }
  , secret: req.options.secret
  })
  const id = util.format('%s-%s', uuid.v4(), uuid.v4()).replace(/-/g, '')

  dbapi.saveUserAccessToken(req.user.email, {
    title: title
  , id: id
  , jwt: jwt
  })
  .then(function(stats) {
    req.options.pushdev.send([
      req.user.group
    , wireutil.envelope(new wire.UpdateAccessTokenMessage())
    ])
    apiutil.respond(res, 201, 'Created (access token)',
      {token: apiutil.publishAccessToken(stats.changes[0]!.new_val)})
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to create access token "%s": ', title, err.stack)
  })
}

function deleteAccessTokens(req: ApiRequest, res: Response) {
  dbapi.removeUserAccessTokens(req.user.email).then(function(stats) {
    if (!stats.deleted) {
     apiutil.respond(res, 200, 'Unchanged (access tokens)')
    }
    else {
      req.options.pushdev.send([
        req.user.group
      , wireutil.envelope(new wire.UpdateAccessTokenMessage())
      ])
      apiutil.respond(res, 200, 'Deleted (access tokens)')
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to delete access tokens: ', err.stack)
  })
}

function deleteAccessToken(req: ApiRequest, res: Response) {
  const id = req.swagger.params.id.value

  dbapi.loadAccessToken(id).then(function(token) {
    if (!token || token.email !== req.user.email) {
      apiutil.respond(res, 404, 'Not Found (access token)')
    }
    else {
      dbapi.removeAccessToken(id).then(function(stats) {
        if (!stats.deleted) {
          apiutil.respond(res, 404, 'Not Found (access token)')
        }
        else {
          req.options.pushdev.send([
            req.user.group
          , wireutil.envelope(new wire.UpdateAccessTokenMessage())
          ])
          apiutil.respond(res, 200, 'Deleted (access token)')
        }
      })
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to delete access token "%s": ', id, err.stack)
  })
}

export {
  getUser
, getUserDevices
, addUserDevice
, getUserDeviceBySerial
, deleteUserDeviceBySerial
, renewAutomationLease
, releaseAutomationLease
, rebootUserDeviceBySerial
, remoteConnectUserDeviceBySerial
, remoteDisconnectUserDeviceBySerial
, getUserAccessTokens
, addAdbPublicKey
, addUserDevice as addUserDeviceV2
, getAccessTokens
, getAccessToken
, createAccessToken
, deleteAccessToken
, deleteAccessTokens
}
