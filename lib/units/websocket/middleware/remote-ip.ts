import proxyaddr from 'proxy-addr'
import type {
  WebsocketMiddlewareNext
, WebsocketMiddlewareSocket
, WebsocketRequest
} from '../../../types/units-websocket.js'

interface RemoteIpOptions {
  trust: Parameters<typeof proxyaddr>[1]
}

export default function(options: RemoteIpOptions) {
  return function(socket: WebsocketMiddlewareSocket, next: WebsocketMiddlewareNext) {
    var req = socket.request as WebsocketRequest
    req.ip = proxyaddr(req, options.trust)
    next()
  }
}
