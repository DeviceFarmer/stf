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
    var wrapper, type, message

    // A message this unit cannot decode, for example one with an enum value
    // from a newer version, must not take the unit down. The listeners are
    // called outside of the try block, so their own errors still surface.
    try {
      wrapper = wire.Envelope.decode(data)
      type = wire.ReverseMessageType[wrapper.type]
      message = type ? wire[type].decode(wrapper.message) : null
    }
    catch (err) {
      log.error(
        'Dropping message of type "%s" that could not be decoded: %s'
      , type || (wrapper ? wrapper.type : 'unknown')
      , (err as Error).message
      )
      return
    }

    if (type) {
      this.emit(
        wrapper.type
      , wrapper.channel || channel
      , message
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
