/**
* Copyright © 2023 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'
import events from 'events'
import net from 'net'

import ForwardReader from './reader.js'
import ForwardWriter from './writer.js'
import type {Duplex} from 'stream'
import type {ReverseForwardFields} from '../../../../../types/wire.js'

type ForwardOptions = Omit<ReverseForwardFields, 'id'>

interface DestHandler extends events.EventEmitter {
  end(): void
  write(chunk: Buffer): void
}

interface DestCtor {
  new(id: number, conn: Duplex, options: ForwardOptions): DestHandler
}

interface ForwardHandler extends events.EventEmitter {
  options: ForwardOptions
  end(): void
}

interface ForwardHandlerCtor {
  new(conn: Duplex, options: ForwardOptions): ForwardHandler
}

interface ForwardManager extends events.EventEmitter {
  has(id: string): boolean
  add(id: string, conn: Duplex, options: ForwardOptions): void
  remove(id: string): void
  removeAll(manager: ForwardManager): void
  listAll(): ReverseForwardFields[]
}

interface ForwardManagerCtor {
  new(): ForwardManager
}

// Handles a single connection
function DestHandler(this: DestHandler, id: number, conn: Duplex, options: ForwardOptions) {
  var dest = net.connect({
      host: options.targetHost
      , port: options.targetPort
    })

  var writer = dest.pipe(new ForwardWriter(id))

  // We can't just pipe to conn because we don't want to end it
  // when the dest closes. Instead we'll send a special packet
  // to it (which is handled by the writer).
  function maybePipeManually() {
    var chunk
    while ((chunk = writer.read())) {
      if (!conn.write(chunk)) {
        break
      }
    }
  }

  function readableListener() {
    maybePipeManually()
  }

  function drainListener() {
    maybePipeManually()
  }

  function endListener(this: DestHandler) {
    conn.removeListener('drain', drainListener)
    writer.removeListener('readable', readableListener)
    this.emit('end')
  }

  function errorListener() {
    writer.end()
  }

  writer.on('end', endListener.bind(this))
  writer.on('readable', readableListener)
  dest.on('error', errorListener)
  conn.on('drain', drainListener)

  this.end = function() {
    dest.end()
  }

  this.write = function(chunk: Buffer) {
    dest.write(chunk)
  }

  events.EventEmitter.call(this)
}

util.inherits(DestHandler, events.EventEmitter)

// Handles a single port
function ForwardHandler(this: ForwardHandler, conn: Duplex, options: ForwardOptions) {
  var destHandlersById: Record<number, DestHandler> = Object.create(null)

  function endListener(this: ForwardHandler) {
    this.emit('end')
  }

  function packetEndListener(id: number) {
    delete destHandlersById[id]
  }

  function packetListener(id: number, packet: Buffer | null) {
    var dest = destHandlersById[id]
    if (packet) {
      if (!dest) {
        // Let's create a new connection
        dest = destHandlersById[id] = new (DestHandler as unknown as DestCtor)(id, conn, options)
        dest.on('end', packetEndListener.bind(null, id))
      }

      dest.write(packet)
    }
    else {
      // It's a simulated fin packet
      if (dest) {
        dest.end()
      }
    }
  }

  function readableListener() {
    // No-op but must exist so that we get the 'end' event.
  }

  conn.pipe(new ForwardReader())
    .on('end', endListener.bind(this))
    .on('packet', packetListener)
    .on('readable', readableListener)

  this.options = options

  this.end = function() {
    conn.end()
  }

  events.EventEmitter.call(this)
}

util.inherits(ForwardHandler, events.EventEmitter)

// Handles multiple ports
function ForwardManager(this: ForwardManager) {
  var handlersById: Record<string, ForwardHandler> = Object.create(null)

  this.has = function(id: string) {
    return !!handlersById[id]
  }

  this.add = function(id: string, conn: Duplex, options: ForwardOptions) {
    function endListener(this: ForwardManager) {
      delete handlersById[id]
      this.emit('remove', id, options)
    }

    if (this.has(id)) {
      this.remove(id)
    }

    for(const handlerId in handlersById) {
      if (handlersById[handlerId]!.options.devicePort === options.devicePort) {
        this.remove(handlerId)
        break
      }
    }

    var handler = new (ForwardHandler as unknown as ForwardHandlerCtor)(conn, options)
    handler.on('end', endListener.bind(this))

    handlersById[id] = handler

    this.emit('add', id, options)
  }

  this.remove = function(id: string) {
    var handler = handlersById[id]
    if (handler) {
      handler.end()
    }
    delete handlersById[id]
    this.emit('remove', id)
  }

  this.removeAll = function(manager: ForwardManager) {
    Object.keys(handlersById).forEach(function(id) {
      handlersById[id]!.end()
      delete handlersById[id]
      manager.emit('remove', id)
    })
  }

  this.listAll = function() {
    return Object.keys(handlersById).map(function(id) {
      var handler = handlersById[id]!
      return {
        id: id
      , devicePort: handler.options.devicePort
      , targetHost: handler.options.targetHost
      , targetPort: handler.options.targetPort
      }
    })
  }

  events.EventEmitter.call(this)
}

util.inherits(ForwardManager, events.EventEmitter)

export default ForwardManager as unknown as ForwardManagerCtor
