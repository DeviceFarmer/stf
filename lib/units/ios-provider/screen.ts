import http from 'node:http'
import {WebSocketServer, WebSocket} from 'ws'
import {authorizeScreen, type IosOwner} from './access.js'
import type {PrototypeClient} from './client.js'
import {CoreDeviceScreenDecoder} from './coredevice-screen.js'

interface ScreenStream {
  controller: AbortController
  sessionId?: string
  releaseInput?: () => void
  lastKeyframeRequest: number
}

const maxBufferedBytes = 1024 * 1024

export function createScreenServer(options: {
  client: PrototypeClient
  apiUrl: string
  publicOrigin: string
  serial: string
  owner: () => IosOwner | null
  mode: () => 'control' | 'automation' | 'unsupported' | 'unavailable'
  connectInput: (
    sessionId: string, signal: AbortSignal, fail: (error: unknown) => void
  ) => (() => void) | undefined
  onError?: (error: unknown) => void
}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404).end()
  })
  const sockets = new WebSocketServer({noServer: true, maxPayload: 1024})
  sockets.on('error', error => {
    options.onError?.(error)
  })
  server.on('upgrade', (req, socket, head) => {
    const owner = options.owner()
    const deadline = setTimeout(() => socket.destroy(), 6000)
    authorizeScreen(options.apiUrl, options.publicOrigin, options.serial, owner, req.headers)
      .then(allowed => {
        clearTimeout(deadline)
        if (socket.destroyed || !allowed || !owner || options.owner() !== owner ||
            req.url !== '/') {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
          return
        }
        sockets.handleUpgrade(req, socket, head, ws => {
          let stream: ScreenStream | null = null
          let alive = true
          let acceptsHevc = false
          const authorized = () => options.owner() === owner
          const receiving = (active: ScreenStream) =>
            stream === active && authorized() && ws.readyState === WebSocket.OPEN
          const stop = () => {
            const previous = stream
            stream = null
            previous?.controller.abort()
            previous?.releaseInput?.()
          }
          const fail = (active: ScreenStream, error: unknown) => {
            if (receiving(active)) {
              stop()
              options.onError?.(error)
              ws.send('hevc unavailable')
            }
          }
          const keyframe = (active: ScreenStream) => {
            const now = performance.now()
            if (active.sessionId && now - active.lastKeyframeRequest >= 1000) {
              active.lastKeyframeRequest = now
              const signal = AbortSignal.any([active.controller.signal, AbortSignal.timeout(2000)])
              options.client.request('/coredevice/keyframe', {sessionId: active.sessionId}, signal)
                .then(response => response.arrayBuffer()).catch(() => {})
            }
          }
          const start = async() => {
            if (stream || !authorized()) {
              return
            }
            const mode = options.mode()
            if (mode === 'automation') {
              ws.send('hevc automation')
              return
            }
            if (!acceptsHevc || mode === 'unsupported') {
              ws.send('hevc unsupported')
              return
            }
            if (mode === 'unavailable') {
              ws.send('hevc unavailable')
              return
            }
            const active: ScreenStream = {
              controller: new AbortController(), lastKeyframeRequest: -Infinity
            }
            stream = active
            try {
              const allowed = await authorizeScreen(
                options.apiUrl, options.publicOrigin, options.serial, owner, req.headers, 'control'
              )
              if (!receiving(active)) {
                return
              }
              if (!allowed) {
                ws.close(1008, 'Device access ended')
                return
              }
              await video(active)
              if (receiving(active)) {
                throw new Error('CoreDevice screen ended')
              }
            }
            catch (error) {
              fail(active, error)
            }
            finally {
              if (stream === active) {
                stop()
              }
            }
          }
          const video = async(active: ScreenStream) => {
            const startup = new AbortController()
            const deadline = setTimeout(() => startup.abort(), 15000)
            const signal = AbortSignal.any([startup.signal, active.controller.signal])
            const response = await options.client.request('/coredevice/screen', undefined, signal)
              .finally(() => clearTimeout(deadline))
            const codec = response.headers.get('x-stf-hevc-codec')
            const description = response.headers.get('x-stf-hevc-description')
            const sessionId = response.headers.get('x-stf-coredevice-session')
            if (!response.body || !codec || !description || !sessionId ||
                !response.headers.get('content-type')?.startsWith('application/octet-stream')) {
              await response.body?.cancel()
              throw new Error('Invalid CoreDevice screen stream')
            }
            if (!receiving(active)) {
              await response.body.cancel()
              return
            }
            active.sessionId = sessionId
            ws.send('hevc ' + JSON.stringify({codec, description}))
            const decoder = new CoreDeviceScreenDecoder()
            let needsKeyframe = true
            for await (const chunk of response.body) {
              if (!receiving(active)) {
                break
              }
              for (const unit of decoder.feed(chunk)) {
                if (ws.bufferedAmount >= maxBufferedBytes) {
                  needsKeyframe = true
                }
                else if (needsKeyframe && unit[0] === 1) {
                  keyframe(active)
                }
                else {
                  if (needsKeyframe) {
                    // Discard old reference frames after we skip packets.
                    unit[0] = 2
                  }
                  needsKeyframe = false
                  ws.send(unit)
                }
              }
            }
          }
          const timer = setInterval(() => {
            if (!alive || !authorized()) {
              ws.terminate()
              return
            }
            alive = false
            ws.ping()
            authorizeScreen(
              options.apiUrl, options.publicOrigin, options.serial, owner, req.headers,
              stream ? 'control' : 'status'
            ).then(allowedNow => {
              if (!allowedNow || !authorized()) {
                ws.close(1008, 'Device access ended')
              }
            })
          }, 5000)
          const cleanup = () => {
            clearInterval(timer)
            stop()
          }
          ws.on('pong', () => {
            alive = true
          })
          ws.on('error', error => {
            options.onError?.(error)
            cleanup()
          })
          ws.on('close', cleanup)
          ws.on('message', data => {
            if (!authorized()) {
              ws.close(1008, 'Device access ended')
              return
            }
            const message = data.toString()
            if (message === 'hevc') {
              acceptsHevc = true
            }
            else if (message === 'on') {
              start()
            }
            else if (message === 'hevc ready' && stream?.sessionId && !stream.releaseInput) {
              const active = stream
              const release = options.connectInput(active.sessionId!, active.controller.signal,
                error => fail(active, error))
              if (release) {
                active.releaseInput = release
                ws.send('hevc input ready')
              }
              else {
                fail(active, new Error('CoreDevice input is unavailable'))
              }
            }
            else if (message === 'hevc keyframe' && stream) {
              keyframe(stream)
            }
            else if (message === 'off') {
              stop()
            }
            else if (message === 'ping') {
              ws.send('pong')
            }
          })
          ws.send('start ' + JSON.stringify({quirks: {alwaysUpright: true}}))
        })
      }).catch(() => {
        clearTimeout(deadline)
        socket.destroy()
      })
  })
  const disconnect = () => {
    for (const ws of sockets.clients) {
      ws.terminate()
    }
  }
  return {server, disconnect, close: () => {
    disconnect()
    sockets.close()
    server.close()
  }}
}
