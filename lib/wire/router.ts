import EventEmitter from 'eventemitter3'
import util from 'util'

import wire from './index.js'
import logger from '../util/logger.js'

type EmitterClass = typeof EventEmitter.default

var log = logger.createLogger('wire:router')
var on = (EventEmitter as unknown as EmitterClass).prototype.on

interface WireMessageClass<M> {
  $code: number
  decode(buffer: Buffer | Uint8Array): M
}

type RouteHandler<M> = (channel: string | Buffer, message: M, data: Buffer) => void
type ChannelHandler = (channel: string | Buffer) => void

interface Router {
  on<M>(message: WireMessageClass<M>, handler: RouteHandler<M>): this
  on(message: {$code: 'message'}, handler: ChannelHandler): this
  removeListener<M>(message: WireMessageClass<M>, handler: RouteHandler<M>): this
  removeListener(message: {$code: 'message'}, handler: ChannelHandler): this
  emit(event: string | number, ...args: unknown[]): boolean
  handler(): (channel: string | Buffer, data: Buffer) => void
}

interface RouterFactory {
  (): Router
  new(): Router
}

function Router(this: Router) {
  if (!(this instanceof Router)) {
    return new (Router as unknown as RouterFactory)()
  }

  (EventEmitter as unknown as (this: Router) => void).call(this)
}

util.inherits(Router, EventEmitter)

Router.prototype.on = function(
  this: Router
, message: {$code: number | string}
, handler: (...args: unknown[]) => void
) {
  return on.call(this, message.$code, handler)
}

Router.prototype.removeListener = function(
  this: Router
, message: {$code: number | string}
, handler: (...args: unknown[]) => void
) {
  return (EventEmitter as unknown as EmitterClass).prototype.removeListener.call(
    this
  , message.$code
  , handler
  )
}

Router.prototype.handler = function(this: Router) {
  return function(this: Router, channel: string | Buffer, data: Buffer) {
    var wrapper = wire.Envelope.decode(data)
    var type = wire.ReverseMessageType[wrapper.type]

    if (type) {
      this.emit(
        wrapper.type
      , wrapper.channel || channel
      , wire[type].decode(wrapper.message)
      , data
      )
      this.emit(
        'message'
      , channel
      )
    }
    else {
      log.warn(
        'Unknown message type "%d", perhaps we need an update?'
      , wrapper.type
      )
    }
  }.bind(this)
}

export default Router as unknown as RouterFactory
