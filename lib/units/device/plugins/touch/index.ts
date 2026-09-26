/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import split from 'split'
import EventEmitter from 'eventemitter3'

import wire from '../../../../wire/index.js'
import logger from '../../../../util/logger.js'
import lifecycle from '../../../../util/lifecycle.js'
import SeqQueue from '../../../../wire/seqqueue.js'
import StateQueue from '../../../../util/statequeue.js'
import RiskyStream from '../../../../util/riskystream.js'
import FailCounter from '../../../../util/failcounter.js'
import type {Duplex} from 'stream'
import adbSyrup from '../../support/adb.js'
import routerSyrup from '../../support/router.js'
import minitouchSyrup from '../../resources/minitouch.js'
import flagsSyrup from '../util/flags.js'

type Adb = ReturnType<typeof import('../../../../util/adbutil.js').default>
type Router = ReturnType<typeof import('../../../../wire/router.js').default>

interface TouchOptions {
  serial: string
}

interface Minitouch {
  run(cmd?: string): Promise<Duplex>
}

interface Flags {
  get(flag: string, defaultValue: string): string
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(routerSyrup)
  .dependency(minitouchSyrup)
  .dependency(flagsSyrup)
  .define(function(
    options: TouchOptions
  , adb: Adb
  , router: Router
  , minitouch: Minitouch
  , flags: Flags
  ) {
    var log = logger.createLogger('device:plugins:touch')

    interface TouchPoint {
      x: number
      y: number
    }

    interface TouchContact {
      contact: number
    }

    interface TouchContactPoint extends TouchPoint, TouchContact {
      pressure?: number | null
    }

    interface TouchConsumerEvents {
      start: () => void
      stop: () => void
      error: (err: Error) => void
    }

    interface TouchOrigin {
      x: (point: TouchPoint) => number
      y: (point: TouchPoint) => number
    }

    class TouchConsumer extends EventEmitter.EventEmitter<TouchConsumerEvents> {
      static STATE_STOPPED = 1
      static STATE_STARTING = 2
      static STATE_STARTED = 3
      static STATE_STOPPING = 4

      declare actionQueue: unknown[]
      declare runningState: number
      declare desiredState: StateQueue
      declare output: RiskyStream | null
      declare socket: RiskyStream | null
      declare banner: Awaited<ReturnType<TouchConsumer['_readBanner']>> | null
      declare touchConfig: {origin: TouchOrigin}
      declare starter: Promise<boolean | void>
      declare failCounter: FailCounter
      declare failed: boolean
      declare readableListener: () => void
      declare writeQueue: Array<(this: TouchConsumer) => unknown>

      constructor(config: {origin: TouchOrigin}) {
        super()
        this.actionQueue = []
        this.runningState = TouchConsumer.STATE_STOPPED
        this.desiredState = new StateQueue()
        this.output = null
        this.socket = null
        this.banner = null
        this.touchConfig = config
        this.starter = Promise.resolve(true)
        this.failCounter = new FailCounter(3, 10000)
        this.failCounter.on('exceedLimit', this._failLimitExceeded.bind(this))
        this.failed = false
        this.readableListener = this._readableListener.bind(this)
        this.writeQueue = []
      }

      _queueWrite(writer: (this: TouchConsumer) => unknown) {
        switch (this.runningState) {
        case TouchConsumer.STATE_STARTED:
          writer.call(this)
          break
        default:
          this.writeQueue.push(writer)
          break
        }
      }

      touchDown(point: TouchContactPoint) {
        this._queueWrite(function(this: TouchConsumer) {
          return this._write(util.format(
            'd %s %s %s %s\n'
          , point.contact
          , Math.floor(this.touchConfig.origin.x(point) * this.banner!.maxX)
          , Math.floor(this.touchConfig.origin.y(point) * this.banner!.maxY)
          , Math.floor((point.pressure || 0.5) * this.banner!.maxPressure)
          ))
        })
      }

      touchMove(point: TouchContactPoint) {
        this._queueWrite(function(this: TouchConsumer) {
          return this._write(util.format(
            'm %s %s %s %s\n'
          , point.contact
          , Math.floor(this.touchConfig.origin.x(point) * this.banner!.maxX)
          , Math.floor(this.touchConfig.origin.y(point) * this.banner!.maxY)
          , Math.floor((point.pressure || 0.5) * this.banner!.maxPressure)
          ))
        })
      }

      touchUp(point: TouchContact) {
        this._queueWrite(function(this: TouchConsumer) {
          return this._write(util.format(
            'u %s\n'
          , point.contact
          ))
        })
      }

      touchCommit() {
        this._queueWrite(function(this: TouchConsumer) {
          return this._write('c\n')
        })
      }

      touchReset() {
        this._queueWrite(function(this: TouchConsumer) {
          return this._write('r\n')
        })
      }

      tap(point: TouchContactPoint) {
        this.touchDown(point)
        this.touchCommit()
        this.touchUp(point)
        this.touchCommit()
      }

      _ensureState() {
        if (this.desiredState.empty()) {
          return
        }

        if (this.failed) {
          log.warn('Will not apply desired state due to too many failures')
          return
        }

        switch (this.runningState) {
        case TouchConsumer.STATE_STARTING:
        case TouchConsumer.STATE_STOPPING:
          // Just wait.
          break
        case TouchConsumer.STATE_STOPPED:
          if (this.desiredState.next() === TouchConsumer.STATE_STARTED) {
            this.runningState = TouchConsumer.STATE_STARTING
            this.starter = this._startService().bind(this)
              .then(function(this: TouchConsumer, out) {
                this.output = new RiskyStream(out)
                  .on('unexpectedEnd', this._outputEnded.bind(this))
                return this._readOutput(this.output.stream)
              })
              .then(function(this: TouchConsumer) {
                return this._connectService()
              })
              .then(function(this: TouchConsumer, socket) {
                this.socket = new RiskyStream(socket)
                  .on('unexpectedEnd', this._socketEnded.bind(this))
                return this._readBanner(this.socket.stream)
              })
              .then(function(this: TouchConsumer, banner) {
                this.banner = banner
                return this._readUnexpected(this.socket!.stream)
              })
              .then(function(this: TouchConsumer) {
                this._processWriteQueue()
              })
              .then(function(this: TouchConsumer) {
                this.runningState = TouchConsumer.STATE_STARTED
                this.emit('start')
              })
              .catch(function(this: TouchConsumer, err) {
                return this._stop().finally(function(this: TouchConsumer) {
                  this.failCounter.inc()
                  this.emit('error', err)
                })
              })
              .finally(function(this: TouchConsumer) {
                this._ensureState()
              })
          }
          else {
            setImmediate(this._ensureState.bind(this))
          }
          break
        case TouchConsumer.STATE_STARTED:
          if (this.desiredState.next() === TouchConsumer.STATE_STOPPED) {
            this.runningState = TouchConsumer.STATE_STOPPING
            this._stop().finally(function(this: TouchConsumer) {
              this._ensureState()
            })
          }
          else {
            setImmediate(this._ensureState.bind(this))
          }
          break
        }
      }

      start() {
        log.info('Requesting touch consumer to start')
        this.desiredState.push(TouchConsumer.STATE_STARTED)
        this._ensureState()
      }

      stop() {
        log.info('Requesting touch consumer to stop')
        this.desiredState.push(TouchConsumer.STATE_STOPPED)
        this._ensureState()
      }

      restart() {
        switch (this.runningState) {
        case TouchConsumer.STATE_STARTED:
        case TouchConsumer.STATE_STARTING:
          this.desiredState.push(TouchConsumer.STATE_STOPPED)
          this.desiredState.push(TouchConsumer.STATE_STARTED)
          this._ensureState()
          break
        }
      }

      _configChanged() {
        this.restart()
      }

      _socketEnded() {
        log.warn('Connection to minitouch ended unexpectedly')
        this.failCounter.inc()
        this.restart()
      }

      _outputEnded() {
        log.warn('Shell keeping minitouch running ended unexpectedly')
        this.failCounter.inc()
        this.restart()
      }

      _failLimitExceeded(limit: number, time: number) {
        this._stop()
        this.failed = true
        this.emit('error', new Error(util.format(
          'Failed more than %d times in %dms'
        , limit
        , time
        )))
      }

      _startService() {
        log.info('Launching touch service')
        return minitouch.run()
          .timeout(10000)
      }

      _readOutput(out: Duplex) {
        out.pipe(split()).on('data', function(line: string) {
          var trimmed = line.toString().trim()

          if (trimmed === '') {
            return
          }

          if (/ERROR/.test(line)) {
            log.fatal('minitouch error: "%s"', line)
            lifecycle.fatal()
            return
          }

          log.info('minitouch says: "%s"', line)
        })
      }

      _connectService() {
        function tryConnect(times: number, delay: number): Promise<Duplex> {
          return adb.openLocal(options.serial, 'localabstract:minitouch')
            .timeout(10000)
            .then(function(out) {
              return out
            })
            .catch(function(err) {
              if (/closed/.test(err.message) && times > 1) {
                return Promise.delay(delay)
                  .then(function() {
                    return tryConnect(times - 1, delay * 2)
                  })
              }
              return Promise.reject(err)
            })
        }
        log.info('Connecting to minitouch service')
        // SH-03G can be very slow to start sometimes. Make sure we try long
        // enough.
        return tryConnect(7, 100)
      }

      _stop() {
        return this._disconnectService(this.socket).bind(this)
          .timeout(2000)
          .then(function(this: TouchConsumer) {
            return this._stopService(this.output).timeout(10000)
          })
          .then(function(this: TouchConsumer) {
            this.runningState = TouchConsumer.STATE_STOPPED
            this.emit('stop')
          })
          .catch(function(this: TouchConsumer, err) {
            // In practice we _should_ never get here due to _stopService()
            // being quite aggressive. But if we do, well... assume it
            // stopped anyway for now.
            this.runningState = TouchConsumer.STATE_STOPPED
            this.emit('error', err)
            this.emit('stop')
          })
          .finally(function(this: TouchConsumer) {
            this.output = null
            this.socket = null
            this.banner = null
          })
      }

      _disconnectService(socket: RiskyStream | null) {
        log.info('Disconnecting from minitouch service')

        if (!socket || socket.ended) {
          return Promise.resolve(true)
        }

        socket.stream.removeListener('readable', this.readableListener)

        var endListener: () => void
        return new Promise<boolean>(function(resolve) {
            socket.on('end', endListener = function() {
              resolve(true)
            })

            socket.stream.resume()
            socket.end()
          })
          .finally(function() {
            socket.removeListener('end', endListener)
          })
      }

      _stopService(output: RiskyStream | null) {
        log.info('Stopping minitouch service')

        if (!output || output.ended) {
          return Promise.resolve(true)
        }

        var pid = this.banner ? this.banner.pid : -1

        function kill(signal: 'SIGTERM' | 'SIGKILL') {
          if (pid <= 0) {
            return Promise.reject(new Error('Minitouch service pid is unknown'))
          }

          var signum = {
            SIGTERM: -15
          , SIGKILL: -9
          }[signal]

          log.info('Sending %s to minitouch', signal)
          return Promise.all([
              output!.waitForEnd()
            , adb.shell(options.serial, ['kill', signum, pid])
                .then(adb.util.readAll)
                .return(true)
            ])
            .timeout(2000)
        }

        function kindKill() {
          return kill('SIGTERM')
        }

        function forceKill() {
          return kill('SIGKILL')
        }

        function forceEnd() {
          log.info('Ending minitouch I/O as a last resort')
          output!.end()
          return Promise.resolve(true)
        }

        return kindKill()
          .catch(Promise.TimeoutError, forceKill)
          .catch(forceEnd)
      }

      _readBanner(socket: Duplex) {
        log.info('Reading minitouch banner')

        var parser = new adb.Parser(socket)
        var banner = {
          pid: -1 // @todo
        , version: 0
        , maxContacts: 0
        , maxX: 0
        , maxY: 0
        , maxPressure: 0
        }

        function readVersion() {
          return parser.readLine()
            .then(function(chunk) {
              var args = chunk.toString().split(/ /g)
              switch (args[0]) {
                case 'v':
                  banner.version = Number(args[1])
                  break
                default:
                  throw new Error(util.format(
                    'Unexpected output "%s", expecting version line'
                  , chunk
                  ))
              }
            })
        }

        function readLimits() {
          return parser.readLine()
            .then(function(chunk) {
              var args = chunk.toString().split(/ /g)
              switch (args[0]) {
                case '^':
                  banner.maxContacts = args[1] as unknown as number
                  banner.maxX = args[2] as unknown as number
                  banner.maxY = args[3] as unknown as number
                  banner.maxPressure = args[4] as unknown as number
                  break
                default:
                  throw new Error(util.format(
                    'Unknown output "%s", expecting limits line'
                  , chunk
                  ))
              }
            })
        }

        function readPid() {
          return parser.readLine()
            .then(function(chunk) {
              var args = chunk.toString().split(/ /g)
              switch (args[0]) {
                case '$':
                  banner.pid = Number(args[1])
                  break
                default:
                  throw new Error(util.format(
                    'Unexpected output "%s", expecting pid line'
                  , chunk
                  ))
              }
            })
        }

        return readVersion()
          .then(readLimits)
          .then(readPid)
          .return(banner)
          .timeout(2000)
      }

      _readUnexpected(socket: Duplex) {
        socket.on('readable', this.readableListener)

        // We may already have data pending.
        this.readableListener()
      }

      _readableListener() {
        var chunk

        while ((chunk = this.socket!.stream.read())) {
          log.warn('Unexpected output from minitouch socket', chunk)
        }
      }

      _processWriteQueue() {
        for (var i = 0, l = this.writeQueue.length; i < l; ++i) {
          this.writeQueue[i]!.call(this)
        }

        this.writeQueue = []
      }

      _write(chunk: string) {
        this.socket!.stream.write(chunk)
      }
    }

    function startConsumer() {
      var touchConsumer = new TouchConsumer({
        // Usually the touch origin is the same as the display's origin,
        // but sometimes it might not be.
        origin: (function(origin: string) {
          log.info('Touch origin is %s', origin)
          var origins: Record<string, TouchOrigin> = {
            'top left': {
              x: function(point: TouchPoint) {
                return point.x
              }
            , y: function(point: TouchPoint) {
                return point.y
              }
            }
            // So far the only device we've seen exhibiting this behavior
            // is Yoga Tablet 8.
          , 'bottom left': {
              x: function(point: TouchPoint) {
                return 1 - point.y
              }
            , y: function(point: TouchPoint) {
                return point.x
              }
            }
          }
          if (!origins[origin]) {
            log.warn('Unknown touch origin "%s", using top left', origin)
          }
          return origins[origin] || origins['top left']!
        })(flags.get('forceTouchOrigin', 'top left'))
      })

      var startListener: () => void, errorListener: (err: Error) => void

      return new Promise<typeof touchConsumer>(function(resolve, reject) {
        touchConsumer.on('start', startListener = function() {
          resolve(touchConsumer)
        })

        touchConsumer.on('error', errorListener = reject)

        touchConsumer.start()
      })
      .finally(function() {
        touchConsumer.removeListener('start', startListener)
        touchConsumer.removeListener('error', errorListener)
      })
    }

    return startConsumer()
      .then(function(touchConsumer) {
        var queue = new SeqQueue(100, 4)

        touchConsumer.on('error', function(err) {
          log.fatal('Touch consumer had an error', err.stack)
          lifecycle.fatal()
        })

        router
          .on(wire.GestureStartMessage, function(channel, message) {
            queue.start(message.seq)
          })
          .on(wire.GestureStopMessage, function(channel, message) {
            queue.push(message.seq, function() {
              queue.stop()
            })
          })
          .on(wire.TouchDownMessage, function(channel, message) {
            queue.push(message.seq, function() {
              touchConsumer.touchDown(message)
            })
          })
          .on(wire.TouchMoveMessage, function(channel, message) {
            queue.push(message.seq, function() {
              touchConsumer.touchMove(message)
            })
          })
          .on(wire.TouchUpMessage, function(channel, message) {
            queue.push(message.seq, function() {
              touchConsumer.touchUp(message)
            })
          })
          .on(wire.TouchCommitMessage, function(channel, message) {
            queue.push(message.seq, function() {
              touchConsumer.touchCommit()
            })
          })
          .on(wire.TouchResetMessage, function(channel, message) {
            queue.push(message.seq, function() {
              touchConsumer.touchReset()
            })
          })

        return touchConsumer
      })
  })
