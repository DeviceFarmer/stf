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
import {inspectMaestroDevice, cleanupMaestroDevice} from '../../../util/maestro-device.js'
import type {MaestroBaseline} from '../../../util/maestro-device.js'
import type {Readable} from 'node:stream'
import type {AutoGroupMessage, OwnerMessage} from '../../../types/wire.js'
import type {
  Adb
, Channels
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
import adbSyrup from '../support/adb.js'

export default syrup.serial()
  .dependency(soloSyrup)
  .dependency(identitySyrup)
  .dependency(serviceSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .dependency(channelsSyrup)
  .dependency(adbSyrup)
  .define(function(
    options: DevicePluginOptions
  , solo: SoloPlugin
  , ident: DeviceIdentity
  , service: ServicePlugin
  , router: Router
  , push: ZmqSocket
  , sub: ZmqSocket
  , channels: Channels
  , adb: Adb
  ) {
    var log = logger.createLogger('device:plugins:group')
    var currentGroup: OwnerMessage | null = null
    let currentLeaseId: string | null = null
    let maestroBaseline: MaestroBaseline | null = null
    let joining: Promise<OwnerMessage> | null = null
    let leaving: Promise<OwnerMessage> | null = null
    let stopping = false

    function executeMaestro(command: string): globalThis.Promise<string> {
      let stream: Readable | null = null
      return adb.shell(options.serial,
        command + '; status=$?; printf \'\n__STF_EXIT__%s\n\' "$status"')
        .then(function(output) {
          stream = output
          return adb.util.readAll(output)
        })
        .timeout(30000)
        .then(function(output) {
          const text = output.toString('utf8').replace(/\r/g, '')
          const match = /\n__STF_EXIT__(\d+)\n$/.exec(text)
          if (!match || match[1] !== '0') {
            throw new Error('Maestro native cleanup command failed')
          }
          return text.slice(0, match.index).trim()
        })
        .finally(function() {
          stream?.destroy()
        })
    }
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
      newGroup: OwnerMessage, timeout, usage, identifier, leaseId, automationRunner
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
          return Promise.try(async function() {
            if (automationRunner === 'maestro' && (usage !== 'automation' || !leaseId)) {
              throw new Error('Maestro requires a fenced automation lease')
            }
            // Capture recovery data before publishing ownership or acknowledging the reservation.
            const baseline = automationRunner === 'maestro' ?
              await inspectMaestroDevice(executeMaestro) : null
            if (stopping) {
              throw new Error('Device worker is stopping')
            }
            const group = new wire.OwnerMessage({...newGroup, reservationId: randomUUID()})
            if (usage === 'automation' && leaseId) {
              automationLease.start(group.email, leaseId, timeout || options.groupTimeout)
            }
            currentGroup = group
            currentLeaseId = usage === 'automation' ? leaseId || null : null
            maestroBaseline = baseline
            log.important('Now owned by "%s"', currentGroup.email)
            log.info('Subscribing to group channel "%s"', currentGroup.group)
            channels.register(currentGroup.group, {
              timeout: leaseId ? Infinity : timeout || options.groupTimeout, alias: solo.channel
            })
            sub.subscribe(currentGroup.group)
            push.send([wireutil.global, wireutil.envelope(new wire.JoinGroupMessage(
              options.serial, currentGroup, usage, leaseId, automationRunner
            ))])
            plugin.emit('join', currentGroup, identifier)
            return currentGroup
          })
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
        .then(async function(group) {
          if (managedUngroup()) {
            throw new grouputil.RequirementMismatchError('leaseId')
          }
          if (reservationId && group.reservationId !== reservationId) {
            throw new grouputil.RequirementMismatchError('reservationId')
          }
          if (maestroBaseline) {
            // A timeout or coordinator outage may end access, but cannot make a running driver free.
            // Retain ownership and the lease ID after failure so the caller can retry cleanup.
            await cleanupMaestroDevice(executeMaestro, maestroBaseline)
          }
          log.important('No longer owned by "%s" (reason: %s)', group.email, reason)
          log.info('Unsubscribing from group channel "%s"', group.group)
          channels.unregister(group.group)
          sub.unsubscribe(group.group)
          push.send([wireutil.global, wireutil.envelope(new wire.LeaveGroupMessage(
            options.serial, group, reason
          ))])
          automationLease.clear()
          currentLeaseId = null
          maestroBaseline = null
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
              , message.automationRunner
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
