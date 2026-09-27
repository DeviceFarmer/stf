import type {IncomingMessage} from 'http'
import type {UserDocument} from './stf.js'

export interface WebsocketOptions {
  port: number
  secret: string
  ssid: string
  storageUrl: string
  endpoints: {
    sub: string[]
    push: string[]
  }
}

export interface WebsocketSessionJwt {
  email: string
  name: string
}

export interface WebsocketSession {
  jwt?: WebsocketSessionJwt
}

export interface WebsocketRequest extends IncomingMessage {
  session: WebsocketSession
  user: UserDocument
  ip: string
}

export interface WebsocketMiddlewareSocket {
  request: IncomingMessage
}

export type WebsocketMiddlewareNext = (err?: Error) => void
