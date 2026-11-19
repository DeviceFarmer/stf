import events from 'events'
import {randomUUID} from 'node:crypto'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import grouputil from '../../../util/grouputil.js'
import lifecycle from '../../../util/lifecycle.js'
import {AutomationLease} from '../../../util/automation-lease.js'
import type {AutoGroupMessage, OwnerMessage} from '../../../types/wire.js'
import type {
  Channels
, DeviceIdentity
, DevicePluginOptions
, GroupPlugin
, Router
, ServicePlugin
, SoloPlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import soloSyrup from './solo.js'
import identitySyrup from './util/identity.js'
import serviceSyrup from './service.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import subSyrup from '../support/sub.js'
import channelsSyrup from '../support/channels.js'

export default syrup.serial()
  .dependency(soloSyrup)
  .dependency(identitySyrup)
  .dependency(serviceSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .dependency(channelsSyrup)
  .define(function(
    options: DevicePluginOptions
  , solo: SoloPlugin
  , ident: DeviceIdentity
  , service: ServicePlugin
  , router: Router
  , push: ZmqSocket
  , sub: ZmqSocket
  , channels: Channels
  ) {
    var log = logger.createLogger('device:plugins:group')
    var currentGroup: OwnerMessage | null = null
    let currentLeaseId: string | null = null
    let joining: Promise<OwnerMessage> | null = null
    let leaving: Promise<OwnerMessage> | null = null
    let stopping = false

    var plugin = new events.EventEmitter() as GroupPlugin
    const automationLease = new AutomationLease(() => {
      plugin.leave('automatic_timeout').catch(log.error.bind(log))
    })

    plugin.get = Promise.method(function() {
      if (!currentGroup) {
        throw new grouputil.NoGroupError()
      }

      return currentGroup
    })

    plugin.join = function(
      newGroup: OwnerMessage, timeout, usage, identifier, leaseId
    ) {
      if (joining || leaving || stopping) {
        return Promise.reject(new grouputil.AlreadyGroupedError())
      }
      const operation = plugin.get()
        .then(function() {
          if (currentGroup!.group !== newGroup.group || leaseId) {
            throw new grouputil.AlreadyGroupedError()
          }
          return currentGroup!
        })
        .catch(grouputil.NoGroupError, function() {
          if (stopping) {
            throw new Error('Device worker is stopping')
          }
          const group = new wire.OwnerMessage({...newGroup, reservationId: randomUUID()})
          const automationLeaseId = usage === 'automation' ? leaseId || null : null
          if (automationLeaseId) {
            automationLease.start(group.email, automationLeaseId, timeout ?? options.groupTimeout)
          }
          currentGroup = group
          currentLeaseId = automationLeaseId
          log.important('Now owned by "%s"', currentGroup.email)
          log.info('Subscribing to group channel "%s"', currentGroup.group)
          channels.register(currentGroup.group, {
            timeout: automationLeaseId ? Infinity : timeout || options.groupTimeout
          , alias: solo.channel
          })
          sub.subscribe(currentGroup.group)
          push.send([wireutil.global, wireutil.envelope(new wire.JoinGroupMessage(
            options.serial, currentGroup, usage, leaseId
          ))])
          plugin.emit('join', currentGroup, identifier)
          return currentGroup
        })
      joining = operation
      return operation.finally(function() {
        if (joining === operation) {
          joining = null
        }
      })
    }

    plugin.keepalive = function() {
      if (currentGroup) {
        channels.keepalive(currentGroup.group)
      }
    }

    plugin.leave = function(reason, reservationId) {
      const managedUngroup = () => reason === 'ungroup_request' && currentLeaseId !== null
      if (managedUngroup()) {
        return Promise.reject(new grouputil.RequirementMismatchError('leaseId'))
      }
      if (leaving) {
        if (reservationId && currentGroup?.reservationId !== reservationId) {
          return Promise.reject(new grouputil.RequirementMismatchError('reservationId'))
        }
        return leaving
      }
      const operation = Promise.resolve(joining).reflect().then(() => plugin.get())
        .then(function(group) {
          if (managedUngroup()) {
            throw new grouputil.RequirementMismatchError('leaseId')
          }
          if (reservationId && group.reservationId !== reservationId) {
            throw new grouputil.RequirementMismatchError('reservationId')
          }
          log.important('No longer owned by "%s" (reason: %s)', group.email, reason)
          log.info('Unsubscribing from group channel "%s"', group.group)
          channels.unregister(group.group)
          sub.unsubscribe(group.group)
          push.send([wireutil.global, wireutil.envelope(new wire.LeaveGroupMessage(
            options.serial, group, reason, reason === 'device_absent' ? null : currentLeaseId
          ))])
          automationLease.clear()
          currentLeaseId = null
          currentGroup = null
          plugin.emit('leave', group)
          return group
        })
      leaving = operation
      return operation.finally(function() {
        if (leaving === operation) {
          leaving = null
        }
      })
    }

    plugin.on('join', function() {
      service.wake()
      service.acquireWakeLock()
    })

    plugin.on('leave', function() {
      if (options.screenReset) {
        service.pressKey('home')
        service.thawRotation()
      }
      service.releaseWakeLock()
    })

    router
      .on(wire.GroupMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        return grouputil.match(
          ident as unknown as Record<string, string | undefined>
        , message.requirements
        )
          .then(function() {
            return plugin.join(
              message.owner, message.timeout, message.usage, undefined, message.leaseId
            )
          })
          .then(function(owner) {
            push.send([
              channel
            , reply.okay(null, {owner})
            ])
          })
          .catch(grouputil.RequirementMismatchError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
          .catch(grouputil.AlreadyGroupedError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
          .catch(function() {
            push.send([channel, reply.fail('Device preparation failed')])
          })
      })
      .on(wire.AutomationLeaseMessage, function(channel, message) {
        const reply = wireutil.reply(options.serial)
        return Promise.try(function() {
          if (message.serial !== options.serial || currentLeaseId !== message.leaseId ||
              currentGroup?.email !== message.owner.email) {
            throw new Error('Stale automation lease')
          }
          if (message.action === 'renew') {
            return {expiresAt: automationLease.renew(
              message.owner.email, message.leaseId, message.timeout || 0
            )}
          }
          if (message.action === 'release') {
            automationLease.clear()
            return plugin.leave('automation_release', currentGroup.reservationId).then(() => null)
          }
          throw new Error('Invalid automation lease action')
        }).then(function(body) {
          push.send([channel, reply.okay(null, body)])
        }).catch(function(error) {
          push.send([channel, reply.fail(error.message)])
        })
      })
      .on(wire.AutoGroupMessage, function(channel, message) {
        return plugin.join(
          message.owner
        , (message as AutoGroupMessage & {timeout?: number}).timeout
        , null
        , message.identifier
        )
          .then(function() {
            plugin.emit('autojoin', message.identifier, true)
          })
          .catch(grouputil.AlreadyGroupedError, function() {
            plugin.emit('autojoin', message.identifier, false)
          })
      })
      .on(wire.UngroupMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        return grouputil.match(
          ident as unknown as Record<string, string | undefined>
        , message.requirements
        )
          .then(function() {
            return plugin.leave('ungroup_request', message.reservationId)
          })
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .catch(grouputil.NoGroupError, grouputil.RequirementMismatchError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
          .catch(function() {
            push.send([channel, reply.fail('Device cleanup failed')])
          })
      })

    channels.on('timeout', function(channel) {
      if (currentGroup && channel === currentGroup.group) {
        plugin.leave('automatic_timeout').catch(log.error.bind(log))
      }
    })

    lifecycle.observe(function() {
      stopping = true
      return plugin.leave('device_absent')
        .catch(grouputil.NoGroupError, function() {
          return true
        })
    })

    return plugin
  })
