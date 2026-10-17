import http from 'node:http'
import {WebSocketServer, WebSocket} from 'ws'
import {authorizeScreen, type IosOwner} from './access.js'
import {MjpegDecoder} from './mjpeg.js'
import type {PrototypeClient} from './client.js'

export function createScreenServer(options: {
  client: PrototypeClient
  apiUrl: string
  publicOrigin: string
  serial: string
  owner: () => IosOwner | null
  keepalive: () => void
  onError?: (error: unknown) => void
}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404).end()
  })
  const sockets = new WebSocketServer({noServer: true, maxPayload: 1024})
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
          let stream: AbortController | null = null
          let alive = true
          ws.on('pong', () => {
            alive = true
          })
          const stop = () => {
            stream?.abort()
            stream = null
          }
          const authorized = () => options.owner() === owner
          const start = async() => {
            if (stream || !authorized()) {
              return
            }
            const active = new AbortController()
            stream = active
            try {
              const response = await options.client.request('/screen', undefined, active.signal)
              if (!response.headers.get('content-type')?.startsWith('multipart/x-mixed-replace') ||
                  !response.body) {
                throw new Error('Invalid screen stream')
              }
              const decoder = new MjpegDecoder()
              for await (const chunk of response.body) {
                if (!authorized() || active.signal.aborted || ws.readyState !== WebSocket.OPEN) {
                  break
                }
                for (const frame of decoder.feed(chunk)) {
                  // Drop frames for slow consumers instead of accumulating screen data.
                  if (ws.bufferedAmount < 1024 * 1024) {
                    ws.send(frame)
                  }
                }
                options.keepalive()
              }
              if (!active.signal.aborted) {
                ws.close(1011, 'Screen stream ended')
              }
            }
            catch (error) {
              if (!active.signal.aborted) {
                options.onError?.(error)
                ws.close(1011, 'Screen unavailable')
              }
            }
            finally {
              active.abort()
              if (stream === active) {
                stream = null
              }
            }
          }
          const timer = setInterval(() => {
            if (!alive) {
              ws.terminate()
              return
            }
            alive = false
            ws.ping()
            authorizeScreen(
              options.apiUrl, options.publicOrigin, options.serial, owner, req.headers
            ).then(allowedNow => {
              if (!allowedNow || !authorized()) {
                ws.close(1008, 'Device access ended')
              }
            })
          }, 5000)
          ws.on('error', stop)
          ws.on('close', () => {
            clearInterval(timer)
            stop()
          })
          ws.on('message', data => {
            if (!authorized()) {
              ws.close(1008, 'Device access ended')
              return
            }
            const message = data.toString()
            if (message === 'on') {
              start()
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
