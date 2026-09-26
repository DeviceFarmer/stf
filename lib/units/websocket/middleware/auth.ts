import dbapi from '../../../db/api.js'
import type {
  WebsocketMiddlewareNext
, WebsocketMiddlewareSocket
, WebsocketRequest
} from '../../../types/units-websocket.js'

export default function(socket: WebsocketMiddlewareSocket, next: WebsocketMiddlewareNext) {
  var req = socket.request as WebsocketRequest
  var token = req.session.jwt
  if (token) {
    return dbapi.loadUser(token.email)
      .then(function(user) {
        if (user) {
          req.user = user
          return next()
        }
        else {
          return next(new Error('Invalid user'))
        }
      })
      .catch(next)
  }
  else {
    return next(new Error('Missing authorization token'))
  }
}
