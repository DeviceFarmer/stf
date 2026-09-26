/**
* Copyright © 2019-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'
import events from 'events'
import util from 'util'

import {Server as Socketio} from 'socket.io'
import Promise from 'bluebird'
import _ from 'lodash'
import * as uuid from 'uuid'

import logger from '../../util/logger.js'
import wire from '../../wire/index.js'
import wireutil from '../../wire/util.js'
import wirerouter from '../../wire/router.js'
import dbapi from '../../db/api.js'
import datautil from '../../util/datautil.js'
import srv from '../../util/srv.js'
import lifecycle from '../../util/lifecycle.js'
import zmqutil from '../../util/zmqutil.js'
import cookieSession from './middleware/cookie-session.js'
import ip from './middleware/remote-ip.js'
import auth from './middleware/auth.js'
import jwtutil from '../../util/jwtutil.js'

import apiutil from '../../util/apiutil.js'
import adbutil from '../../util/adbutil.js'
import cypressRequest from '@cypress/request'
import type {DefaultEventsMap} from 'socket.io'
import type {
  AccountAddMessageFields
, AccountCheckMessageFields
, AccountGetMessageFields
, AccountRemoveMessageFields
, BatteryEvent
, BluetoothSetEnabledMessageFields
, BrowserClearMessageFields
, BrowserOpenMessageFields
, ConnectivityEvent
, DeviceBrowserMessage
, DeviceStatusMessage
, FileSystemGetMessageFields
, FileSystemListMessageFields
, ForwardCreateMessageFields
, ForwardRemoveMessageFields
, ForwardTestMessageFields
, LogcatStartMessageFields
, PasteMessageFields
, PhoneStateEvent
, RingerSetMessageFields
, RotateMessageFields
, ShellCommandMessageFields
, ShellKeepAliveMessageFields
, TouchCommitMessageFields
, TouchDownMessageFields
, TouchMoveMessageFields
, TouchUpMessageFields
, TypeMessageFields
, UninstallMessageFields
, WifiSetEnabledMessageFields
} from '../../types/wire.js'
import type {WebsocketOptions, WebsocketRequest} from '../../types/units-websocket.js'

var request = Promise.promisifyAll(cypressRequest) as unknown as PromisifiedRequest
var adb = adbutil()

interface PromisifiedRequest {
  postAsync(options: cypressRequest.Options): Promise<http.IncomingMessage>
}

type WireEnvelopeMessage = Parameters<typeof wireutil.envelope>[0]
type MessageListener = ReturnType<ReturnType<typeof wirerouter>['handler']>
type DeviceRequirements = Parameters<typeof wireutil.toDeviceRequirements>[0]
type SerialStripped<M extends {serial: string}> = Omit<M, 'serial'> & {serial?: string}
type StrippedBrowserMessage = SerialStripped<DeviceBrowserMessage>
type LabelledStatusMessage = DeviceStatusMessage & {likelyLeaveReason?: string}

interface KeyEventData {
  key: string
}

interface GroupInviteData {
  timeout?: number | null
  requirements: DeviceRequirements
}

interface GroupKickData {
  requirements: DeviceRequirements
}

interface InstallData {
  href: string
  launch?: boolean
  manifest: unknown
}

type ChannelEvent<D> = (channel: string, data: D) => void
type TransactionEvent = (channel: string, responseChannel: string) => void
type TransactionDataEvent<D> = (channel: string, responseChannel: string, data: D) => void

interface WebsocketClientEvents {
  'device.note': (data: {serial: string, note: string}) => void
  'user.settings.update': (data: object) => void
  'user.settings.reset': () => void
  'user.keys.accessToken.generate': (data: {title: string}) => void
  'user.keys.accessToken.remove': (data: {title: string}) => void
  'user.keys.adb.add': (data: {title: string, key: string}) => void
  'user.keys.adb.accept': (data: {title: string, fingerprint: string}) => void
  'user.keys.adb.remove': (data: {fingerprint: string}) => void
  'input.touchDown': ChannelEvent<TouchDownMessageFields>
  'input.touchMove': ChannelEvent<TouchMoveMessageFields>
  'input.touchUp': ChannelEvent<TouchUpMessageFields>
  'input.touchCommit': ChannelEvent<TouchCommitMessageFields>
  'input.touchReset': ChannelEvent<TouchCommitMessageFields>
  'input.gestureStart': ChannelEvent<TouchCommitMessageFields>
  'input.gestureStop': ChannelEvent<TouchCommitMessageFields>
  'input.keyDown': ChannelEvent<KeyEventData>
  'input.keyUp': ChannelEvent<KeyEventData>
  'input.keyPress': ChannelEvent<KeyEventData>
  'input.type': ChannelEvent<TypeMessageFields>
  'display.rotate': ChannelEvent<RotateMessageFields>
  'clipboard.paste': TransactionDataEvent<PasteMessageFields>
  'clipboard.copy': TransactionEvent
  'device.identify': TransactionEvent
  'device.reboot': TransactionEvent
  'account.check': TransactionDataEvent<AccountCheckMessageFields>
  'account.remove': TransactionDataEvent<AccountRemoveMessageFields>
  'account.addmenu': TransactionEvent
  'account.add': TransactionDataEvent<AccountAddMessageFields>
  'account.get': TransactionDataEvent<AccountGetMessageFields>
  'sd.status': TransactionEvent
  'ringer.set': TransactionDataEvent<RingerSetMessageFields>
  'ringer.get': TransactionEvent
  'wifi.set': TransactionDataEvent<WifiSetEnabledMessageFields>
  'wifi.get': TransactionEvent
  'bluetooth.set': TransactionDataEvent<BluetoothSetEnabledMessageFields>
  'bluetooth.get': TransactionEvent
  'bluetooth.cleanBonds': TransactionEvent
  'group.invite': TransactionDataEvent<GroupInviteData>
  'group.kick': TransactionDataEvent<GroupKickData>
  'tx.cleanup': (channel: string) => void
  'tx.punch': (channel: string) => void
  'shell.command': TransactionDataEvent<ShellCommandMessageFields>
  'shell.keepalive': ChannelEvent<ShellKeepAliveMessageFields>
  'device.install': TransactionDataEvent<InstallData>
  'device.uninstall': TransactionDataEvent<UninstallMessageFields>
  'storage.upload': TransactionDataEvent<{url: string}>
  'forward.test': TransactionDataEvent<ForwardTestMessageFields>
  'forward.create': TransactionDataEvent<ForwardCreateMessageFields>
  'forward.remove': TransactionDataEvent<ForwardRemoveMessageFields>
  'logcat.start': TransactionDataEvent<LogcatStartMessageFields>
  'logcat.stop': TransactionEvent
  'connect.start': TransactionEvent
  'connect.stop': TransactionEvent
  'browser.open': TransactionDataEvent<BrowserOpenMessageFields>
  'browser.clear': TransactionDataEvent<BrowserClearMessageFields>
  'store.open': TransactionEvent
  'screen.capture': TransactionEvent
  'fs.retrieve': TransactionDataEvent<FileSystemGetMessageFields>
  'fs.list': TransactionDataEvent<FileSystemListMessageFields>
}

export default function(options: WebsocketOptions) {
  var log = logger.createLogger('websocket')
  var server = http.createServer()
  var io = new Socketio<WebsocketClientEvents, DefaultEventsMap>(server, {
        serveClient: false
      , transports: ['websocket']
      })
  var channelRouter = new events.EventEmitter()

  // Output
  var push = zmqutil.socket('push')
  Promise.map(options.endpoints.push, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Sending output to "%s"', record.url)
        push.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to push endpoint', err)
    lifecycle.fatal()
  })

  // Input
  var sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
  .catch(function(err) {
    log.fatal('Unable to connect to sub endpoint', err)
    lifecycle.fatal()
  })

  // Establish always-on channels
  ;[wireutil.global].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  sub.on('message', function(channel: Buffer, data: Buffer) {
    channelRouter.emit(channel.toString(), channel, data)
  })

  io.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))

  io.use(ip({
    trust: function() {
      return true
    }
  }))

  io.use(auth)

  io.on('connection', function(socket) {
    var req = socket.request as WebsocketRequest
    var user = req.user
    var channels: string[] = []
    var messageListener: MessageListener

    user.ip = socket.handshake.query.uip as string | undefined || req.ip
    socket.emit('socket.ip', user.ip)

    function joinChannel(channel: string) {
      channels.push(channel)
      channelRouter.on(channel, messageListener)
      sub.subscribe(channel)
    }

    function leaveChannel(channel: string) {
      _.pull(channels, channel)
      channelRouter.removeListener(channel, messageListener)
      sub.unsubscribe(channel)
    }

    function createKeyHandler(Klass: new(key: string) => WireEnvelopeMessage) {
      return function(channel: string, data: KeyEventData) {
        push.send([
          channel
        , wireutil.envelope(new Klass(
            data.key
          ))
        ])
      }
    }

    let disconnectSocket: (value?: unknown) => void
    messageListener = wirerouter()
      .on(wire.UpdateAccessTokenMessage, function() {
        socket.emit('user.keys.accessToken.updated')
      })
      .on(wire.DeleteUserMessage, function() {
        disconnectSocket(true)
      })
      .on(wire.DeviceChangeMessage, function(channel, message) {
        if (user.groups.subscribed.indexOf(message.device.group!.id!) > -1) {
          socket.emit('device.change', {
            important: true
            , data: {
                serial: message.device.serial
              , group: message.device.group
            }
          })
        }
        if (user.groups.subscribed.indexOf(message.device.group!.origin!) > -1 ||
            user.groups.subscribed.indexOf(message.oldOriginGroupId) > -1) {
          socket.emit('user.settings.devices.' + message.action, message)
        }
      })
      .on(wire.UserChangeMessage, function(channel, message) {
        Promise.map(message.targets, function(target) {
          socket.emit('user.' + target + '.users.' + message.action, message)
        })
      })
      .on(wire.GroupChangeMessage, function(channel, message) {
        if (user.privilege === 'admin' ||
            user.email === message.group.owner.email ||
            !apiutil.isOriginGroup(message.group.class) &&
            (message.action === 'deleted' ||
             message.action === 'updated' &&
             (message.isChangedDates || message.isChangedClass || message.devices.length))) {
          socket.emit('user.settings.groups.' + message.action, message)
        }
        if (message.subscribers.indexOf(user.email) > -1) {
          socket.emit('user.view.groups.' + message.action, message)
        }
      })
      .on(wire.DeviceGroupChangeMessage, function(channel, message) {
        if (user.groups.subscribed.indexOf(message.id) > -1) {
          if (user.groups.subscribed.indexOf(message.group.id) > -1) {
            socket.emit('device.updateGroupDevice', {
              important: true
            , data: {
                serial: message.serial
              , group: message.group
              }
            })
          }
          else {
            socket.emit('device.removeGroupDevices', {important: true, devices: [message.serial]})
          }
        }
        else if (user.groups.subscribed.indexOf(message.group.id) > -1) {
          socket.emit('device.addGroupDevices', {important: true, devices: [message.serial]})
        }
      })
      .on(wire.GroupUserChangeMessage, function(channel, message) {
        if (message.users.indexOf(user.email) > -1) {
          if (message.isAdded) {
            user.groups.subscribed = _.union(user.groups.subscribed, [message.id])
            if (message.devices.length) {
              socket.emit('device.addGroupDevices', {important: true, devices: message.devices})
            }
          }
          else {
            if (message.devices.length) {
              socket.emit('device.removeGroupDevices', {important: true, devices: message.devices})
            }
            if (message.isDeletedLater) {
              setTimeout(function() {
                user.groups.subscribed = _.without(user.groups.subscribed, message.id)
              }, 5000)
            }
            else {
              user.groups.subscribed = _.without(user.groups.subscribed, message.id)
            }
          }
        }
      })
      .on(wire.DeviceLogMessage, function(channel, message) {
        socket.emit('device.log', message)
      })
      .on(wire.DeviceIntroductionMessage, function(channel, message) {
        if (user.groups.subscribed.indexOf(message.group!.id) > -1) {
          socket.emit('device.add', {
            important: true
          , data: {
              serial: message.serial
            , present: true
            , provider: message.provider
            , owner: null
            , status: message.status
            , ready: false
            , reverseForwards: []
            , group: message.group
            , statusTimeStamp: message.statusTimeStamp
            }
          })
        }
      })
      .on(wire.DeviceReadyMessage, function(channel, message) {
        socket.emit('device.change', {
          important: true
        , data: {
            serial: message.serial
          , channel: message.channel
          , owner: null // @todo Get rid of need to reset this here.
          , ready: true
          , reverseForwards: [] // @todo Get rid of need to reset this here.
          }
        })
      })
      .on(wire.DevicePresentMessage, function(channel, message) {
        socket.emit('device.change', {
          important: true
        , data: {
            serial: message.serial
          , present: true
          }
        })
      })
      .on(wire.DeviceAbsentMessage, function(channel, message) {
        socket.emit('device.remove', {
          important: true
        , data: {
            serial: message.serial
          , present: false
          , likelyLeaveReason: 'device_absent'
          }
        })
      })
      .on(wire.JoinGroupMessage, function(channel, message) {
        socket.emit('device.change', {
          important: true
        , data: datautil.applyOwner({
              serial: message.serial
            , owner: message.owner
            , likelyLeaveReason: 'owner_change'
            , usage: message.usage
            }
          , user
          )
        })
      })
      .on(wire.JoinGroupByAdbFingerprintMessage, function(channel, message) {
        socket.emit('user.keys.adb.confirm', {
          title: message.comment
        , fingerprint: message.fingerprint
        })
      })
      .on(wire.LeaveGroupMessage, function(channel, message) {
        socket.emit('device.change', {
          important: true
        , data: datautil.applyOwner({
              serial: message.serial
            , owner: null
            , likelyLeaveReason: message.reason
            }
          , user
          )
        })
      })
      .on(wire.DeviceStatusMessage, function(channel, message: LabelledStatusMessage) {
        message.likelyLeaveReason = 'status_change'
        socket.emit('device.change', {
          important: true
        , data: message
        })
      })
      .on(wire.DeviceIdentityMessage, function(channel, message) {
        datautil.applyData(message)
        socket.emit('device.change', {
          important: true
        , data: message
        })
      })
      .on(wire.TransactionProgressMessage, function(channel, message) {
        socket.emit('tx.progress', channel.toString(), message)
      })
      .on(wire.TransactionDoneMessage, function(channel, message) {
        socket.emit('tx.done', channel.toString(), message)
      })
      .on(wire.DeviceLogcatEntryMessage, function(channel, message) {
        socket.emit('logcat.entry', message)
      })
      .on(wire.AirplaneModeEvent, function(channel, message) {
        socket.emit('device.change', {
          important: true
        , data: {
            serial: message.serial
          , airplaneMode: message.enabled
          }
        })
      })
      .on(wire.BatteryEvent, function(channel, message: SerialStripped<BatteryEvent>) {
        var serial = message.serial
        delete message.serial
        socket.emit('device.change', {
          important: false
        , data: {
            serial: serial
          , battery: message
          }
        })
      })
      .on(wire.DeviceBrowserMessage, function(channel, message: StrippedBrowserMessage) {
        var serial = message.serial
        delete message.serial
        socket.emit('device.change', {
          important: true
        , data: datautil.applyBrowsers({
            serial: serial
          , browser: message
          })
        })
      })
      .on(wire.ConnectivityEvent, function(channel, message: SerialStripped<ConnectivityEvent>) {
        var serial = message.serial
        delete message.serial
        socket.emit('device.change', {
          important: false
        , data: {
            serial: serial
          , network: message
          }
        })
      })
      .on(wire.PhoneStateEvent, function(channel, message: SerialStripped<PhoneStateEvent>) {
        var serial = message.serial
        delete message.serial
        socket.emit('device.change', {
          important: false
        , data: {
            serial: serial
          , network: message
          }
        })
      })
      .on(wire.RotationEvent, function(channel, message) {
        socket.emit('device.change', {
          important: false
        , data: {
            serial: message.serial
          , display: {
              rotation: message.rotation
            }
          }
        })
      })
      .on(wire.ReverseForwardsEvent, function(channel, message) {
        socket.emit('device.change', {
          important: false
        , data: {
            serial: message.serial
          , reverseForwards: message.forwards
          }
        })
      })
      .handler()

    // Global messages
    //
    // @todo Use socket.io to push global events to all clients instead
    // of listening on every connection, otherwise we're very likely to
    // hit EventEmitter's leak complaints (plus it's more work)
    channelRouter.on(wireutil.global, messageListener)

    // User's private group
    joinChannel(user.group)

    new Promise(function(resolve) {
      disconnectSocket = resolve
      socket.on('disconnect', resolve)
        // Global messages for all clients using socket.io
        //
        // Device note
        .on('device.note', function(data) {
          return dbapi.setDeviceNote(data.serial, data.note)
            .then(function() {
              return dbapi.loadDevice(user.groups.subscribed, data.serial)
            })
            .then(function(cursor) {
              if (cursor) {
                cursor.next(function(err, device) {
                  if (!err) {
                    io.emit('device.change', {
                      important: true
                    , data: {
                        serial: device.serial
                      , notes: device.notes
                      }
                    })
                  }
                })
              }
            })
        })
        // Client specific messages
        //
        // Settings
        .on('user.settings.update', function(data) {
          dbapi.updateUserSettings(user.email, data)
        })
        .on('user.settings.reset', function() {
          dbapi.resetUserSettings(user.email)
        })
        .on('user.keys.accessToken.generate', function(data) {
          var jwt = jwtutil.encode({
            payload: {
              email: user.email
            , name: user.name
            }
          , secret: options.secret
          })

          var tokenId = util.format('%s-%s', uuid.v4(), uuid.v4()).replace(/-/g, '')
          var title = data.title

          return dbapi.saveUserAccessToken(user.email, {
            title: title
          , id: tokenId
          , jwt: jwt
          })
            .then(function() {
              socket.emit('user.keys.accessToken.generated', {
                title: title
              , tokenId: tokenId
              })
            })
        })
        .on('user.keys.accessToken.remove', function(data) {
          return dbapi.removeUserAccessToken(user.email, data.title)
            .then(function() {
              socket.emit('user.keys.accessToken.updated')
            })
        })
        .on('user.keys.adb.add', function(data) {
          return adb.util.parsePublicKey(data.key)
            .then(function(key) {
              return dbapi.lookupUsersByAdbKey(key.fingerprint)
                .then(function(cursor) {
                  return cursor.toArray()
                })
                .then(function(users) {
                  if (users.length) {
                    throw new dbapi.DuplicateSecondaryIndexError()
                  }
                  else {
                    return dbapi.insertUserAdbKey(user.email, {
                      title: data.title
                    , fingerprint: key.fingerprint
                    , publicKey: data.key.trim()
                    })
                  }
                })
                .then(function() {
                  socket.emit('user.keys.adb.added', {
                    title: data.title
                  , fingerprint: key.fingerprint
                  })
                })
            })
            .then(function() {
              push.send([
                wireutil.global
              , wireutil.envelope(new wire.AdbKeysUpdatedMessage())
              ])
            })
            .catch(dbapi.DuplicateSecondaryIndexError, function() {
              socket.emit('user.keys.adb.error', {
                message: 'Someone already added this key'
              })
            })
            .catch(Error, function(err) {
              socket.emit('user.keys.adb.error', {
                message: err.message
              })
            })
        })
        .on('user.keys.adb.accept', function(data) {
          return dbapi.lookupUsersByAdbKey(data.fingerprint)
            .then(function(cursor) {
              return cursor.toArray()
            })
            .then(function(users) {
              if (users.length) {
                throw new dbapi.DuplicateSecondaryIndexError()
              }
              else {
                return dbapi.insertUserAdbKey(user.email, {
                  title: data.title
                , fingerprint: data.fingerprint
                })
              }
            })
            .then(function() {
              socket.emit('user.keys.adb.added', {
                title: data.title
              , fingerprint: data.fingerprint
              })
            })
            .then(function() {
              push.send([
                user.group
              , wireutil.envelope(new wire.AdbKeysUpdatedMessage())
              ])
            })
            .catch(dbapi.DuplicateSecondaryIndexError, function() {
              // No-op
            })
        })
        .on('user.keys.adb.remove', function(data) {
          return dbapi.deleteUserAdbKey(user.email, data.fingerprint)
            .then(function() {
              socket.emit('user.keys.adb.removed', data)
            })
        })
        // Touch events
        .on('input.touchDown', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.TouchDownMessage(
              data.seq
            , data.contact
            , data.x
            , data.y
            , data.pressure
            ))
          ])
        })
        .on('input.touchMove', function(channel, data) {
          try {
            push.send([
              channel
            , wireutil.envelope(new wire.TouchMoveMessage(
                data.seq
              , data.contact
              , data.x
              , data.y
              , data.pressure
              ))
            ])
          }
          catch(err) {
            // workaround for https://github.com/openstf/stf/issues/1180
            log.error('input.touchMove had an error', (err as Error).stack)
          }
        })
        .on('input.touchUp', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.TouchUpMessage(
              data.seq
            , data.contact
            ))
          ])
        })
        .on('input.touchCommit', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.TouchCommitMessage(
              data.seq
            ))
          ])
        })
        .on('input.touchReset', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.TouchResetMessage(
              data.seq
            ))
          ])
        })
        .on('input.gestureStart', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.GestureStartMessage(
              data.seq
            ))
          ])
        })
        .on('input.gestureStop', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.GestureStopMessage(
              data.seq
            ))
          ])
        })
        // Key events
        .on('input.keyDown', createKeyHandler(wire.KeyDownMessage))
        .on('input.keyUp', createKeyHandler(wire.KeyUpMessage))
        .on('input.keyPress', createKeyHandler(wire.KeyPressMessage))
        .on('input.type', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.TypeMessage(
              data.text
            ))
          ])
        })
        .on('display.rotate', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.RotateMessage(
              data.rotation
            ))
          ])
        })
        // Transactions
        .on('clipboard.paste', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.PasteMessage(data.text)
            )
          ])
        })
        .on('clipboard.copy', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.CopyMessage()
            )
          ])
        })
        .on('device.identify', function(channel, responseChannel) {
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.PhysicalIdentifyMessage()
            )
          ])
        })
        .on('device.reboot', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.RebootMessage()
            )
          ])
        })
        .on('account.check', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.AccountCheckMessage(data)
            )
          ])
        })
        .on('account.remove', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.AccountRemoveMessage(data)
            )
          ])
        })
        .on('account.addmenu', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.AccountAddMenuMessage()
            )
          ])
        })
        .on('account.add', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.AccountAddMessage(data.user, data.password)
            )
          ])
        })
        .on('account.get', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.AccountGetMessage(data)
            )
          ])
        })
        .on('sd.status', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.SdStatusMessage()
            )
          ])
        })
        .on('ringer.set', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.RingerSetMessage(data.mode)
            )
          ])
        })
        .on('ringer.get', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.RingerGetMessage()
            )
          ])
        })
        .on('wifi.set', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.WifiSetEnabledMessage(data.enabled)
            )
          ])
        })
        .on('wifi.get', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.WifiGetStatusMessage()
            )
          ])
        })
        .on('bluetooth.set', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
            , wireutil.transaction(
              responseChannel
              , new wire.BluetoothSetEnabledMessage(data.enabled)
            )
          ])
        })
        .on('bluetooth.get', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
            , wireutil.transaction(
              responseChannel
              , new wire.BluetoothGetStatusMessage()
            )
          ])
        })
        .on('bluetooth.cleanBonds', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
            , wireutil.transaction(
              responseChannel
              , new wire.BluetoothCleanBondedMessage()
            )
          ])
        })
        .on('group.invite', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.GroupMessage(
                new wire.OwnerMessage(
                  user.email
                , user.name
                , user.group
                )
              , data.timeout || null
              , wireutil.toDeviceRequirements(data.requirements)
              )
            )
          ])
        })
        .on('group.kick', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.UngroupMessage(
                wireutil.toDeviceRequirements(data.requirements)
              )
            )
          ])
        })
        .on('tx.cleanup', function(channel) {
          leaveChannel(channel)
        })
        .on('tx.punch', function(channel) {
          joinChannel(channel)
          socket.emit('tx.punch', channel)
        })
        .on('shell.command', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ShellCommandMessage(data)
            )
          ])
        })
        .on('shell.keepalive', function(channel, data) {
          push.send([
            channel
          , wireutil.envelope(new wire.ShellKeepAliveMessage(data))
          ])
        })
        .on('device.install', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.InstallMessage(
                data.href
              , data.launch === true
              , JSON.stringify(data.manifest)
              )
            )
          ])
        })
        .on('device.uninstall', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.UninstallMessage(data)
            )
          ])
        })
        .on('storage.upload', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          request.postAsync({
              url: util.format(
                '%sapi/v1/resources?channel=%s'
              , options.storageUrl
              , responseChannel
              )
            , json: true
            , body: {
                url: data.url
              }
            })
            .catch(function(err) {
              log.error('Storage upload had an error', err.stack)
              leaveChannel(responseChannel)
              socket.emit('tx.cancel', responseChannel, {
                success: false
              , data: 'fail_upload'
              })
            })
        })
        .on('forward.test', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          if (!data.targetHost || data.targetHost === 'localhost') {
            data.targetHost = user.ip
          }
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ForwardTestMessage(data)
            )
          ])
        })
        .on('forward.create', function(channel, responseChannel, data) {
          if (!data.targetHost || data.targetHost === 'localhost') {
            data.targetHost = user.ip
          }
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ForwardCreateMessage(data)
            )
          ])
        })
        .on('forward.remove', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ForwardRemoveMessage(data)
            )
          ])
        })
        .on('logcat.start', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.LogcatStartMessage(data)
            )
          ])
        })
        .on('logcat.stop', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.LogcatStopMessage()
            )
          ])
        })
        .on('connect.start', function(channel, responseChannel) {
          joinChannel(responseChannel)
          // Read fresh, as keys may have been added or filled in since the socket was opened
          return dbapi.loadUserAdbPublicKeys(user.email)
            .catch(function(err) {
              log.error('Failed to load ADB public keys of "%s"', user.email, err.stack)
              return []
            })
            .then(function(adbPublicKeys) {
              push.send([
                channel
              , wireutil.transaction(
                  responseChannel
                , new wire.ConnectStartMessage(user.email, adbPublicKeys)
                )
              ])
            })
        })
        .on('connect.stop', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ConnectStopMessage()
            )
          ])
        })
        .on('browser.open', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.BrowserOpenMessage(data)
            )
          ])
        })
        .on('browser.clear', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.BrowserClearMessage(data)
            )
          ])
        })
        .on('store.open', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.StoreOpenMessage()
            )
          ])
        })
        .on('screen.capture', function(channel, responseChannel) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.ScreenCaptureMessage()
            )
          ])
        })
        .on('fs.retrieve', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.FileSystemGetMessage(data)
            )
          ])
        })
        .on('fs.list', function(channel, responseChannel, data) {
          joinChannel(responseChannel)
          push.send([
            channel
          , wireutil.transaction(
              responseChannel
            , new wire.FileSystemListMessage(data)
            )
          ])
        })
    })
    .finally(function() {
      // Clean up all listeners and subscriptions
      channelRouter.removeListener(wireutil.global, messageListener)
      channels.forEach(function(channel) {
        channelRouter.removeListener(channel, messageListener)
        sub.unsubscribe(channel)
      })
      socket.disconnect(true)
    })
    .catch(function(err) {
      // Cannot guarantee integrity of client
      log.error(
        'Client had an error, disconnecting due to probable loss of integrity'
      , err.stack
      )
      // move 'socket.disconnect(true)' statement to finally block instead!
    })
  })

  lifecycle.observe(function() {
    [push, sub].forEach(function(sock) {
      try {
        sock.close()
      }
      catch (err) {
        // No-op
      }
    })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
