//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import net from 'net'
import util from 'util'
import os from 'os'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'
import * as uuid from 'uuid'
import jpeg from '@julusian/jpeg-turbo'

import logger from '../../../../util/logger.js'
import grouputil from '../../../../util/grouputil.js'
import wire from '../../../../wire/index.js'
import wireutil from '../../../../wire/util.js'
import lifecycle from '../../../../util/lifecycle.js'

import VncServer from './util/server.js'
import VncConnection from './util/connection.js'
import PointerTranslator from './util/pointertranslator.js'
import type {EventEmitter} from 'events'
import type Bluebird from 'bluebird'
import type {OwnerMessage} from '../../../../types/wire.js'
import routerSyrup from '../../support/router.js'
import pushSyrup from '../../support/push.js'
import streamSyrup from '../screen/stream.js'
import touchSyrup from '../touch/index.js'
import groupSyrup from '../group.js'
import soloSyrup from '../solo.js'

type SyrupValue<S> = S extends syrup.Syrup<infer T> ? T : never
type Router = ReturnType<typeof import('../../../../wire/router.js').default>
type Push = ReturnType<typeof import('../../../../util/zmqutil.js').default['socket']>
type ScreenStream = SyrupValue<typeof import('../screen/stream.js').default>
type Touch = SyrupValue<typeof import('../touch/index.js').default>

interface VncOptions {
  serial: string
  vncPort: number
  vncInitialSize: number[]
}

interface VncAuthData {
  response: Buffer
}

interface Group extends EventEmitter {
  get(): Bluebird<OwnerMessage>
  keepalive(): void
}

interface Solo {
  channel: string
}

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(streamSyrup)
  .dependency(touchSyrup)
  .dependency(groupSyrup)
  .dependency(soloSyrup)
  .define(function(
    options: VncOptions
  , router: Router
  , push: Push
  , screenStream: ScreenStream
  , touch: Touch
  , group: Group
  , solo: Solo
  ) {
    var log = logger.createLogger('device:plugins:vnc')

    function vncAuthHandler(data: VncAuthData) {
      log.info(
        'VNC authentication attempt using "%s"'
      , data.response.toString('hex')
      )

      var resolve_: () => void, reject_: (err: Error) => void
      var promise = new Promise<void>(function(resolve, reject) {
        resolve_ = resolve
        reject_ = reject
      })

      function notify() {
        group.get()
          .then(function(currentGroup) {
            push.send([
              solo.channel
            , wireutil.envelope(new wire.JoinGroupByVncAuthResponseMessage(
                options.serial
              , data.response.toString('hex')
              , currentGroup.group
              ))
            ])
          })
          .catch(grouputil.NoGroupError, function() {
            push.send([
              solo.channel
            , wireutil.envelope(new wire.JoinGroupByVncAuthResponseMessage(
                options.serial
              , data.response.toString('hex')
              ))
            ])
          })
      }

      function joinListener(newGroup: OwnerMessage, identifier?: string) {
        if (!data.response.equals(Buffer.from(identifier || '', 'hex'))) {
          reject_(new Error('Someone else took the device'))
        }
      }

      function autojoinListener(identifier: string, joined: boolean) {
        if (data.response.equals(Buffer.from(identifier, 'hex'))) {
          if (joined) {
            resolve_()
          }
          else {
            reject_(new Error('Device is already in use'))
          }
        }
      }

      group.on('join', joinListener)
      group.on('autojoin', autojoinListener)
      router.on(wire.VncAuthResponsesUpdatedMessage, notify)

      notify()

      return promise
        .timeout(5000)
        .finally(function() {
          group.removeListener('join', joinListener)
          group.removeListener('autojoin', autojoinListener)
          router.removeListener(wire.VncAuthResponsesUpdatedMessage, notify)
        })
    }

    function createServer() {
      log.info('Starting VNC server on port %d', options.vncPort)

      var opts = {
        name: options.serial
      , width: options.vncInitialSize[0]!
      , height: options.vncInitialSize[1]!
      , security: [{
          type: VncConnection.SECURITY_VNC
        , challenge: Buffer.alloc(16).fill(0)
        , auth: vncAuthHandler
        }]
      }

      var vnc = new VncServer(net.createServer({
        allowHalfOpen: true
      }), opts)

      var listeningListener: () => void, errorListener: (err: Error) => void
      return new Promise<typeof vnc>(function(resolve, reject) {
          listeningListener = function() {
            return resolve(vnc)
          }

          errorListener = function(err: Error) {
            return reject(err)
          }

          vnc.on('listening', listeningListener)
          vnc.on('error', errorListener)

          vnc.listen(options.vncPort)
        })
        .finally(function() {
          vnc.removeListener('listening', listeningListener)
          vnc.removeListener('error', errorListener)
        })
    }

    return createServer()
      .then(function(vnc) {
        vnc.on('connection', function(conn) {
          log.info('New VNC connection from %s', conn.conn.remoteAddress)

          var id = util.format('vnc-%s', uuid.v4())

          var connState = {
            lastFrame: null as Buffer | null
          , lastFrameTime: null as number | null
          , frameWidth: 0
          , frameHeight: 0
          , sentFrameTime: null as number | null
          , updateRequests: 0
          , frameConfig: {
              format: jpeg.FORMAT_RGB
            }
          }

          var pointerTranslator = new PointerTranslator()

          pointerTranslator.on('touchdown', function(event) {
            touch.touchDown(event)
          })

          pointerTranslator.on('touchmove', function(event) {
            touch.touchMove(event)
          })

          pointerTranslator.on('touchup', function(event) {
            touch.touchUp(event)
          })

          pointerTranslator.on('touchcommit', function() {
            touch.touchCommit()
          })

          function maybeSendFrame() {
            if (!connState.updateRequests) {
              return
            }

            if (!connState.lastFrame) {
              return
            }

            if (connState.lastFrameTime === connState.sentFrameTime) {
              return
            }

            // per-frame decode, going async here would reorder frames
            // eslint-disable-next-line no-sync
            var decoded = jpeg.decompressSync(
              connState.lastFrame, connState.frameConfig)

            conn.writeFramebufferUpdate([{
                xPosition: 0
              , yPosition: 0
              , width: decoded.width
              , height: decoded.height
              , encodingType: VncConnection.ENCODING_RAW
              , data: decoded.data
              }
            , {
                xPosition: 0
              , yPosition: 0
              , width: decoded.width
              , height: decoded.height
              , encodingType: VncConnection.ENCODING_DESKTOPSIZE
              }
            ])

            connState.updateRequests = 0
            connState.sentFrameTime = connState.lastFrameTime
          }

          function vncStartListener(frameProducer: ScreenStream) {
            return new Promise<void>(function(resolve) {
              connState.frameWidth = frameProducer.banner!.virtualWidth
              connState.frameHeight = frameProducer.banner!.virtualHeight
              resolve()
            })
          }

          function vncFrameListener(frame: Buffer) {
            return new Promise<void>(function(resolve) {
              connState.lastFrame = frame
              connState.lastFrameTime = Date.now()
              maybeSendFrame()
              resolve()
            })
          }

          function groupLeaveListener() {
            conn.end()
          }

          conn.on('authenticated', function() {
            screenStream.updateProjection(
              options.vncInitialSize[0]!, options.vncInitialSize[1]!)
            screenStream.broadcastSet.insert(id, {
              onStart: vncStartListener
            , onFrame: vncFrameListener
            })
          })

          conn.on('fbupdaterequest', function() {
            connState.updateRequests += 1
            maybeSendFrame()
          })

          conn.on('formatchange', function(format) {
            var same = os.endianness() === 'BE' ===
              Boolean(format.bigEndianFlag)
            var formatOrder = (format.redShift > format.blueShift) === same

            switch (format.bitsPerPixel) {
            case 8:
              connState.frameConfig = {
                format: jpeg.FORMAT_GRAY
              }
              break
            case 24:
              connState.frameConfig = {
                format: formatOrder ? jpeg.FORMAT_BGR : jpeg.FORMAT_RGB
              }
              break
            case 32:
              var f
              if (formatOrder) {
                f = format.blueShift === 0 ? jpeg.FORMAT_BGRX : jpeg.FORMAT_XBGR
              }
              else {
                f = format.redShift === 0 ? jpeg.FORMAT_RGBX : jpeg.FORMAT_XRGB
              }
              connState.frameConfig = {
                format: f
              }
              break
            }
          })

          conn.on('pointer', function(event) {
            pointerTranslator.push(event)
          })

          conn.on('close', function() {
            screenStream.broadcastSet.remove(id)
            group.removeListener('leave', groupLeaveListener)
          })

          conn.on('userActivity', function() {
            group.keepalive()
          })

          group.on('leave', groupLeaveListener)
        })

        lifecycle.observe(function() {
          vnc.close()
        })
      })
  })
