/**
* Copyright © 2024-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import Promise from 'bluebird'
import _ from 'lodash'
import EventEmitter from 'eventemitter3'

import logger from '../../util/logger.js'
import wire from '../../wire/index.js'
import wireutil from '../../wire/util.js'
import wirerouter from '../../wire/router.js'
import procutil from '../../util/procutil.js'
import lifecycle from '../../util/lifecycle.js'
import srv from '../../util/srv.js'
import zmqutil from '../../util/zmqutil.js'

import timeutil from '../../util/timeutil.js'
import type {ChildProcess, Serializable} from 'child_process'
import type {Device} from '@devicefarmer/adbkit'
import type adbutil from '../../util/adbutil.js'
import type {ProviderOptions} from '../../types/provider.js'

var require = createRequire(import.meta.url)

interface WorkerPromise extends Promise<void> {
  stop(): Promise<Promise.Inspection<void> | void>
}

interface TrackedDevice extends Device {
  present?: boolean
}

export default function(options: ProviderOptions) {
  var log = logger.createLogger('provider')
  var client: ReturnType<typeof adbutil> = require('../../util/adbutil.js').default(options)
  var workers: {[serial: string]: WorkerPromise} = {}
  var solo = wireutil.makePrivateChannel()
  var lists = {
    all: [] as string[]
  , ready: [] as string[]
  , waiting: [] as string[]
  }
  var totalsTimer: NodeJS.Timeout | undefined

  // To make sure that we always bind the same type of service to the same
  // port, we must ensure that we allocate ports in fixed groups.
  var ports = options.ports.slice(
    0
  , options.ports.length - options.ports.length % 4
  )

  // Information about total devices
  var delayedTotals = (function() {
    function totals() {
      if (lists.waiting.length) {
        log.info(
          'Providing %d of %d device(s); waiting for "%s"'
        , lists.ready.length
        , lists.all.length
        , lists.waiting.join('", "')
        )

        delayedTotals()
      }
      else if (lists.ready.length < lists.all.length) {
        log.info(
          'Providing all %d of %d device(s); ignoring "%s"'
        , lists.ready.length
        , lists.all.length
        , _.difference(lists.all, lists.ready).join('", "')
        )
      }
      else {
        log.info(
          'Providing all %d device(s)'
        , lists.all.length
        )
      }
    }

    return function() {
      clearTimeout(totalsTimer)
      totalsTimer = setTimeout(totals, 10000)
    }
  })()

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
  ;[solo].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  // Track and manage devices
  client.trackDevices().then(function(tracker) {
    log.info('Tracking devices')

    // This can happen when ADB doesn't have a good connection to
    // the device
    function isWeirdUnusableDevice(device: Device) {
      return device.id === '????????????'
    }

    // Check whether the device is remote (i.e. if we're connecting to
    // an IP address (or hostname) and port pair).
    function isRemoteDevice(device: Device) {
      return device.id.indexOf(':') !== -1
    }

    // Helper for ignoring unwanted devices
    function filterDevice(listener: (device: TrackedDevice) => void) {
      return function(device: TrackedDevice) {
        if (isWeirdUnusableDevice(device)) {
          log.warn('ADB lists a weird device: "%s"', device.id)
          return false
        }
        if (!options.allowRemote && isRemoteDevice(device)) {
          log.info(
            'Filtered out remote device "%s", use --allow-remote to override'
          , device.id
          )
          return false
        }
        if (options.filter && !options.filter(device)) {
          log.info('Filtered out device "%s"', device.id)
          return false
        }
        return listener(device)
      }
    }

    // To make things easier, we're going to cheat a little, and make all
    // device events go to their own EventEmitters. This way we can keep all
    // device data in the same scope.
    var flippedTracker = new (EventEmitter as unknown as typeof EventEmitter.default)()

    tracker.on('add', filterDevice(function(device: TrackedDevice) {
      log.info('Found device "%s" (%s)', device.id, device.type)

      var privateTracker = new (EventEmitter as unknown as typeof EventEmitter.default)()
      var willStop = false
      var timer: NodeJS.Timeout | undefined, worker: WorkerPromise | null | undefined

      // Wait for others to acknowledge the device
      var register = new Promise(function(resolve) {
        var registerTimeout = 15000
        var settled = false
        function settle(viaAck: boolean) {
          if (settled) {
            return
          }
          settled = true
          if (!viaAck) {
            log.warn(
              'Registration ack for "%s" not received in %dms; proceeding anyway'
            , device.id
            , registerTimeout
            )
          }
          resolve()
        }

        // Tell others we found a device
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceIntroductionMessage(
            device.id
          , wireutil.toDeviceStatus(device.type)
          , new wire.ProviderMessage(
              solo
            , options.name
            )
          , timeutil.now('nano')
          ))
        ])

        privateTracker.once('register', function() {
          settle(true)
        })
        setTimeout(function() {
          settle(false)
        }, registerTimeout)
      })


      // Spawn a device worker
      function spawn() {
        var allocatedPorts = ports.splice(0, 4)
        var proc: ChildProcess = options.fork(device, allocatedPorts.slice())
        var resolve_: (value: void | PromiseLike<void>) => void, reject_: (reason: unknown) => void
        var deferredPromise = new Promise<void>(function(resolve, reject) {
          resolve_ = resolve
          reject_ = reject
        })
        var didExit = false

        function exitListener(code: number | null, signal: NodeJS.Signals | null) {
          didExit = true
          if (signal) {
            log.warn(
              'Device worker "%s" was killed with signal %s, assuming ' +
              'deliberate action and not restarting'
              , device.id
              , signal
            )
            resolve_()
          }
          else if (code === 0) {
            log.info('Device worker "%s" stopped cleanly', device.id)
            resolve_()
          }
          else {
            reject_(new procutil.ExitError(code as number))
          }
        }

        function errorListener(err: Error) {
          log.error(
            'Device worker "%s" had an error: %s'
            , device.id
            , err.message
          )
        }

        function messageListener(message: Serializable) {
          switch (message) {
            case 'ready':
              _.pull(lists.waiting, device.id)
              lists.ready.push(device.id)
              break
            default:
              log.warn(
                'Unknown message from device worker "%s": "%s"'
                , device.id
                , message
              )
              break
          }
        }

        proc.on('exit', exitListener)
        proc.on('error', errorListener)
        proc.on('message', messageListener)

        lists.waiting.push(device.id)

        var promise = deferredPromise
          .finally(function() {
            log.info('Cleaning up device worker "%s"', device.id)

            proc.removeListener('exit', exitListener)
            proc.removeListener('error', errorListener)
            proc.removeListener('message', messageListener)

            // Return used ports to the main pool
            Array.prototype.push.apply(ports, allocatedPorts)

            // Update lists
            _.pull(lists.ready, device.id)
            _.pull(lists.waiting, device.id)
          }) as WorkerPromise

        promise.stop = function() {
          if (didExit) {
            return promise.reflect()
          }

          log.info('Gracefully killing device worker "%s"', device.id)

          var killed = procutil.gracefullyKill(proc, options.killTimeout)
            .catch(Promise.TimeoutError, function(err) {
              log.error(
                'Device worker "%s" did not stop in time: %s'
                , device.id
                , err.message
              )
            })

          resolve_(killed)

          return killed
        }

        return promise
      }

      // Starts a device worker and keeps it alive
      function work(): Promise<void> {
        worker = spawn()
        workers[device.id] = worker
        return worker
          .then(function() {
            log.info('Device worker "%s" has retired', device.id)
            delete workers[device.id]
            worker = null

            // Tell others the device is gone
            push.send([
              wireutil.global
              , wireutil.envelope(new wire.DeviceAbsentMessage(
                device.id
              ))
            ])
          })
          .catch(procutil.ExitError, function(err) {
            if (!willStop) {
              log.error(
                'Device worker "%s" died with code %s'
                , device.id
                , err.code
              )
              log.info('Restarting device worker "%s"', device.id)
              return Promise.delay(500)
                .then(function() {
                  return work()
                })
            }
            return Promise.resolve()
          })
      }

      // No more work required
      function stop() {
        if (worker) {
          log.info('Shutting down device worker "%s"', device.id)
          worker.stop()
        }
      }

      // Check if we can do anything with the device
      function check() {
        clearTimeout(timer)

        if (device.present) {
          // We might get multiple status updates in rapid succession,
          // so let's wait for a while
          switch (device.type) {
            case 'device':
            case 'emulator':
              willStop = false
              timer = setTimeout(work, 100)
              break
            default:
              willStop = true
              timer = setTimeout(stop, 100)
              break
          }
        }
        else {
          willStop = true
          stop()
        }
      }

      register.then(function() {
        log.info('Registered device "%s"', device.id)
        check()
      })

      // Statistics
      lists.all.push(device.id)
      delayedTotals()

      // Will be set to false when the device is removed
      _.assign(device, {
        present: true
      })

      // When any event occurs on the added device
      function deviceListener(type: string, updatedDevice: TrackedDevice) {
        // Okay, this is a bit unnecessary but it allows us to get rid of an
        // ugly switch statement and return to the original style.
        privateTracker.emit(type, updatedDevice)
      }

      // When the added device changes
      function changeListener(updatedDevice: TrackedDevice) {
        register.then(function() {
          log.info(
            'Device "%s" is now "%s" (was "%s")'
          , device.id
          , updatedDevice.type
          , device.type
          )

          _.assign(device, {
            type: updatedDevice.type
          })

          // Tell others the device changed
          push.send([
            wireutil.global
          , wireutil.envelope(new wire.DeviceStatusMessage(
              device.id
            , wireutil.toDeviceStatus(device.type)
            , timeutil.now('nano')
            ))
          ])

          check()
        })
      }

      // When the added device gets removed
      function removeListener() {
        register.then(function() {
          log.info('Lost device "%s" (%s)', device.id, device.type)

          clearTimeout(timer)
          flippedTracker.removeListener(device.id, deviceListener)
          _.pull(lists.all, device.id)
          delayedTotals()

          // Tell others the device is gone
          push.send([
            wireutil.global
          , wireutil.envelope(new wire.DeviceAbsentMessage(
              device.id
            ))
          ])

          _.assign(device, {
            present: false
          })

          check()
        })
      }

      flippedTracker.on(device.id, deviceListener)
      privateTracker.on('change', changeListener)
      privateTracker.on('remove', removeListener)
    }))

    tracker.on('change', filterDevice(function(device: TrackedDevice) {
      flippedTracker.emit(device.id, 'change', device)
    }))

    tracker.on('remove', filterDevice(function(device: TrackedDevice) {
      flippedTracker.emit(device.id, 'remove', device)
    }))

    sub.on('message', wirerouter()
      .on(wire.DeviceRegisteredMessage, function(channel, message) {
        flippedTracker.emit(message.serial, 'register')
      })
      .handler())

    lifecycle.share('Tracker', tracker)
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

    clearTimeout(totalsTimer)

    return Promise.all(Object.keys(workers).map(function(serial) {
      return workers[serial]!.stop()
    }))
  })
}
