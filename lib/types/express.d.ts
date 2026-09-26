import events from 'events'
import zmq from 'zeromq/v5-compat.js'

declare global {
  namespace Express {
    interface ApiRequestOptions {
      push: zmq.Socket
      sub: zmq.Socket
      pushdev: zmq.Socket
      subdev: zmq.Socket
      channelRouter: events.EventEmitter
      secret: string
    }

    interface Request {
      options?: ApiRequestOptions
    }

    interface User {
      email?: string
    }
  }
}
