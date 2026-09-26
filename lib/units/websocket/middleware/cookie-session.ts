import cookieSession from 'cookie-session'
import type express from 'express'
import type {
  WebsocketMiddlewareNext
, WebsocketMiddlewareSocket
} from '../../../types/units-websocket.js'

export default function(options: CookieSessionInterfaces.CookieSessionOptions) {
  var session = cookieSession(options)
  return function(socket: WebsocketMiddlewareSocket, next: WebsocketMiddlewareNext) {
    var req = socket.request
    var res = Object.create(null)
    session(req as express.Request, res, next as express.NextFunction)
  }
}
