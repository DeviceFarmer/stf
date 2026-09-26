import EventEmitter from 'eventemitter3'
import createDebug from 'debug'

import VncConnection from './connection.js'
import type {Server, Socket} from 'net'

var debug = createDebug('vnc:server')

interface VncServerEvents {
  listening: () => void
  connection: (conn: VncConnection) => void
  close: () => void
  error: (err: Error) => void
}

class VncServer extends EventEmitter.EventEmitter<VncServerEvents> {
  declare options: VncConnection['options']
  declare _bound: {
    _listeningListener: () => void
    _connectionListener: (conn: Socket) => void
    _closeListener: () => void
    _errorListener: (err: Error) => void
  }
  declare server: Server

  constructor(server: Server, options: VncConnection['options']) {
    super()
    this.options = options

    this._bound = {
      _listeningListener: this._listeningListener.bind(this)
    , _connectionListener: this._connectionListener.bind(this)
    , _closeListener: this._closeListener.bind(this)
    , _errorListener: this._errorListener.bind(this)
    }

    this.server = server
      .on('listening', this._bound._listeningListener)
      .on('connection', this._bound._connectionListener)
      .on('close', this._bound._closeListener)
      .on('error', this._bound._errorListener)
  }

  close() {
    this.server.close()
  }

  listen(port: number): void
  listen() {
    this.server.listen.apply(this.server, arguments as unknown as [number])
  }

  _listeningListener() {
    this.emit('listening')
  }

  _connectionListener(conn: Socket) {
    debug('connection', conn.remoteAddress, conn.remotePort)
    this.emit('connection', new VncConnection(conn, this.options))
  }

  _closeListener() {
    this.emit('close')
  }

  _errorListener(err: Error) {
    this.emit('error', err)
  }
}

export default VncServer
