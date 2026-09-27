import util from 'util'
import os from 'os'
import crypto from 'crypto'

import EventEmitter from 'eventemitter3'
import createDebug from 'debug'
import Promise from 'bluebird'

import PixelFormat from './pixelformat.js'
import type {Socket} from 'net'

var debug = createDebug('vnc:connection')

interface VncSecurity {
  type: number
  challenge?: Buffer
  auth(data?: VncAuthData): Promise<unknown>
}

interface VncAuthData {
  response: Buffer
}

interface VncPointerEvent {
  buttonMask: number
  xPosition: number
  yPosition: number
}

interface VncFramebufferUpdateRequest {
  incremental: number
  xPosition: number
  yPosition: number
  width: number
  height: number
}

interface VncRectangle {
  xPosition: number
  yPosition: number
  width: number
  height: number
  encodingType: number
  data?: Buffer
}

interface VncConnectionEvents {
  error: (err: Error) => void
  end: () => void
  close: () => void
  authenticated: () => void
  userActivity: () => void
  formatchange: (format: PixelFormat) => void
  fbupdaterequest: (request: VncFramebufferUpdateRequest) => void
  pointer: (event: VncPointerEvent) => void
}

interface NoAssertBuffer extends Buffer {
  readUInt16BE(offset: number, noAssert?: boolean): number
  readInt32BE(offset: number, noAssert?: boolean): number
}

interface VncConnectionOptions {
  name: string
  width: number
  height: number
  security: VncSecurity[]
  challenge?: Buffer
}

var StateReverse: Record<number, string> = Object.create(null)
var State = {
  STATE_NEED_CLIENT_VERSION: 10
, STATE_NEED_CLIENT_SECURITY: 20
, STATE_NEED_CLIENT_INIT: 30
, STATE_NEED_CLIENT_VNC_AUTH: 31
, STATE_NEED_CLIENT_MESSAGE: 40
, STATE_NEED_CLIENT_MESSAGE_SETPIXELFORMAT: 50
, STATE_NEED_CLIENT_MESSAGE_SETENCODINGS: 60
, STATE_NEED_CLIENT_MESSAGE_SETENCODINGS_VALUE: 61
, STATE_NEED_CLIENT_MESSAGE_FBUPDATEREQUEST: 70
, STATE_NEED_CLIENT_MESSAGE_KEYEVENT: 80
, STATE_NEED_CLIENT_MESSAGE_POINTEREVENT: 90
, STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT: 100
, STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT_VALUE: 101
}

Object.keys(State).map(function(name) {
  StateReverse[State[name as keyof typeof State]] = name
})

class VncConnection extends EventEmitter.EventEmitter<VncConnectionEvents> {
  static V3_003 = 3003
  static V3_007 = 3007
  static V3_008 = 3008
  static SECURITY_NONE = 1
  static SECURITY_VNC = 2
  static SECURITYRESULT_OK = 0
  static SECURITYRESULT_FAIL = 1
  static CLIENT_MESSAGE_SETPIXELFORMAT = 0
  static CLIENT_MESSAGE_SETENCODINGS = 2
  static CLIENT_MESSAGE_FBUPDATEREQUEST = 3
  static CLIENT_MESSAGE_KEYEVENT = 4
  static CLIENT_MESSAGE_POINTEREVENT = 5
  static CLIENT_MESSAGE_CLIENTCUTTEXT = 6
  static SERVER_MESSAGE_FBUPDATE = 0
  static ENCODING_RAW = 0
  static ENCODING_DESKTOPSIZE = -223
  static STATE_NEED_CLIENT_VERSION = 10
  static STATE_NEED_CLIENT_SECURITY = 20
  static STATE_NEED_CLIENT_INIT = 30
  static STATE_NEED_CLIENT_VNC_AUTH = 31
  static STATE_NEED_CLIENT_MESSAGE = 40
  static STATE_NEED_CLIENT_MESSAGE_SETPIXELFORMAT = 50
  static STATE_NEED_CLIENT_MESSAGE_SETENCODINGS = 60
  static STATE_NEED_CLIENT_MESSAGE_SETENCODINGS_VALUE = 61
  static STATE_NEED_CLIENT_MESSAGE_FBUPDATEREQUEST = 70
  static STATE_NEED_CLIENT_MESSAGE_KEYEVENT = 80
  static STATE_NEED_CLIENT_MESSAGE_POINTEREVENT = 90
  static STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT = 100
  static STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT_VALUE = 101

  declare options: VncConnectionOptions
  declare _bound: {
    _errorListener: (err: Error) => void
    _readableListener: () => void
    _endListener: () => void
    _closeListener: () => void
  }
  declare _buffer: Buffer | null
  declare _state: number
  declare _serverVersion: number
  declare _serverSupportedSecurity: VncSecurity[]
  declare _serverSupportedSecurityByType: Record<number, VncSecurity>
  declare _serverWidth: number
  declare _serverHeight: number
  declare _serverPixelFormat: PixelFormat
  declare _serverName: string
  declare _clientVersion: number | null
  declare _clientShare: boolean | number
  declare _clientSecurity: number | null
  declare _clientPixelFormat: PixelFormat
  declare _clientEncodingCount: number
  declare _clientEncodings: number[]
  declare _clientCutTextLength: number
  declare _authChallenge: Buffer
  declare conn: Socket
  declare _blockingOps: Promise<unknown>[]

  constructor(conn: Socket, options: VncConnectionOptions) {
    super()
    this.options = options

    this._bound = {
      _errorListener: this._errorListener.bind(this)
    , _readableListener: this._readableListener.bind(this)
    , _endListener: this._endListener.bind(this)
    , _closeListener: this._closeListener.bind(this)
    }

    this._buffer = null
    this._state = 0
    this._changeState(VncConnection.STATE_NEED_CLIENT_VERSION)

    this._serverVersion = VncConnection.V3_008
    this._serverSupportedSecurity = this.options.security
    this._serverSupportedSecurityByType =
      this.options.security.reduce(
        function(map: Record<number, VncSecurity>, method) {
          map[method.type] = method
          return map
        }
      , Object.create(null)
    )
    this._serverWidth = this.options.width
    this._serverHeight = this.options.height
    this._serverPixelFormat = new PixelFormat({
      bitsPerPixel: 32
    , depth: 24
    , bigEndianFlag: os.endianness() === 'BE' ? 1 : 0
    , trueColorFlag: 1
    , redMax: 255
    , greenMax: 255
    , blueMax: 255
    , redShift: 16
    , greenShift: 8
    , blueShift: 0
    })
    this._serverName = this.options.name

    this._clientVersion = null
    this._clientShare = false
    this._clientPixelFormat = this._serverPixelFormat
    this._clientEncodingCount = 0
    this._clientEncodings = []
    this._clientCutTextLength = 0

    this._authChallenge = this.options.challenge || crypto.randomBytes(16)

    this.conn = conn
      .on('error', this._bound._errorListener)
      .on('readable', this._bound._readableListener)
      .on('end', this._bound._endListener)
      .on('close', this._bound._closeListener)

    this._blockingOps = []

    this._writeServerVersion()
    this._read()
  }

  end() {
    this.conn.end()
  }

  writeFramebufferUpdate(rectangles: VncRectangle[]) {
    var chunk = Buffer.alloc(4)
    chunk[0] = VncConnection.SERVER_MESSAGE_FBUPDATE
    chunk[1] = 0
    chunk.writeUInt16BE(rectangles.length, 2)
    this._write(chunk)

    rectangles.forEach(function(this: VncConnection, rect) {
      var rchunk = Buffer.alloc(12)
      rchunk.writeUInt16BE(rect.xPosition, 0)
      rchunk.writeUInt16BE(rect.yPosition, 2)
      rchunk.writeUInt16BE(rect.width, 4)
      rchunk.writeUInt16BE(rect.height, 6)
      rchunk.writeInt32BE(rect.encodingType, 8)
      this._write(rchunk)

      switch (rect.encodingType) {
      case VncConnection.ENCODING_RAW:
        this._write(rect.data!)
        break
      case VncConnection.ENCODING_DESKTOPSIZE:
        this._serverWidth = rect.width
        this._serverHeight = rect.height
        break
      default:
        throw new Error(util.format(
          'Unsupported encoding type', rect.encodingType))
      }
    }, this)
  }

  _error(err: Error) {
    this.emit('error', err)
    this.end()
  }

  _errorListener(err: Error) {
    this._error(err)
  }

  _endListener() {
    this.emit('end')
  }

  _closeListener() {
    this.emit('close')
  }

  _writeServerVersion() {
    // Yes, we could just format the string instead. Didn't feel like it.
    switch (this._serverVersion) {
    case VncConnection.V3_003:
      this._write(Buffer.from('RFB 003.003\n'))
      break
    case VncConnection.V3_007:
      this._write(Buffer.from('RFB 003.007\n'))
      break
    case VncConnection.V3_008:
      this._write(Buffer.from('RFB 003.008\n'))
      break
    }
  }

  _writeSupportedSecurity() {
    var chunk = Buffer.alloc(1 + this._serverSupportedSecurity.length)

    chunk[0] = this._serverSupportedSecurity.length
    this._serverSupportedSecurity.forEach(function(security, i) {
      chunk[1 + i] = security.type
    })

    this._write(chunk)
  }

  _writeSecurityResult(result: number, reason?: string) {
    var chunk
    switch (result) {
    case VncConnection.SECURITYRESULT_OK:
      chunk = Buffer.alloc(4)
      chunk.writeUInt32BE(result, 0)
      this._write(chunk)
      break
    case VncConnection.SECURITYRESULT_FAIL:
      chunk = Buffer.alloc(4 + 4 + reason!.length)
      chunk.writeUInt32BE(result, 0)
      chunk.writeUInt32BE(reason!.length, 4)
      chunk.write(reason!, 8, reason!.length)
      this._write(chunk)
      break
    }
  }

  _writeServerInit() {
    debug('server pixel format', this._serverPixelFormat)
    var chunk = Buffer.alloc(2 + 2 + 16 + 4 + this._serverName.length)
    chunk.writeUInt16BE(this._serverWidth, 0)
    chunk.writeUInt16BE(this._serverHeight, 2)
    chunk[4] = this._serverPixelFormat.bitsPerPixel
    chunk[5] = this._serverPixelFormat.depth
    chunk[6] = this._serverPixelFormat.bigEndianFlag
    chunk[7] = this._serverPixelFormat.trueColorFlag
    chunk.writeUInt16BE(this._serverPixelFormat.redMax, 8)
    chunk.writeUInt16BE(this._serverPixelFormat.greenMax, 10)
    chunk.writeUInt16BE(this._serverPixelFormat.blueMax, 12)
    chunk[14] = this._serverPixelFormat.redShift
    chunk[15] = this._serverPixelFormat.greenShift
    chunk[16] = this._serverPixelFormat.blueShift
    chunk[17] = 0 // padding
    chunk[18] = 0 // padding
    chunk[19] = 0 // padding
    chunk.writeUInt32BE(this._serverName.length, 20)
    chunk.write(this._serverName, 24, this._serverName.length)
    this._write(chunk)
  }

  _writeVncAuthChallenge() {
    var vncSec = this._serverSupportedSecurityByType[VncConnection.SECURITY_VNC]!
    debug('vnc auth challenge', vncSec.challenge)
    this._write(vncSec.challenge!)
  }

  _readableListener() {
    this._read()
  }

  _read() {
    Promise.all(this._blockingOps).bind(this)
      .then(this._unguardedRead)
  }

  _auth(type: number, data?: VncAuthData) {
    var security = this._serverSupportedSecurityByType[type]!
    this._blockingOps.push(
      security.auth(data).bind(this)
        .then(function(this: VncConnection) {
          this._changeState(VncConnection.STATE_NEED_CLIENT_INIT)
          this._writeSecurityResult(VncConnection.SECURITYRESULT_OK)
          this.emit('authenticated')
          this._read()
        })
        .catch(function(this: VncConnection) {
          this._writeSecurityResult(
            VncConnection.SECURITYRESULT_FAIL, 'Authentication failure')
          this.end()
        })
    )
  }

  _unguardedRead() {
    var chunk: NoAssertBuffer | null, lo, hi
    while (this._append(this.conn.read())) {
      do {
        debug('state', StateReverse[this._state])
        chunk = null
        switch (this._state) {
        case VncConnection.STATE_NEED_CLIENT_VERSION:
          if ((chunk = this._consume(12))) {
            if ((this._clientVersion = this._parseVersion(chunk)) === null) {
              this.end()
              return
            }
            debug('client version', this._clientVersion)
            this._writeSupportedSecurity()
            this._changeState(VncConnection.STATE_NEED_CLIENT_SECURITY)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_SECURITY:
          if ((chunk = this._consume(1))) {
            if ((this._clientSecurity = this._parseSecurity(chunk)) === null) {
              this._writeSecurityResult(
                VncConnection.SECURITYRESULT_FAIL, 'Unimplemented security type')
              this.end()
              return
            }
            debug('client security', this._clientSecurity)
            if (!(this._clientSecurity in this._serverSupportedSecurityByType)) {
              this._writeSecurityResult(
                VncConnection.SECURITYRESULT_FAIL, 'Unsupported security type')
              this.end()
              return
            }
            switch (this._clientSecurity) {
            case VncConnection.SECURITY_NONE:
              this._auth(VncConnection.SECURITY_NONE)
              return
            case VncConnection.SECURITY_VNC:
              this._writeVncAuthChallenge()
              this._changeState(VncConnection.STATE_NEED_CLIENT_VNC_AUTH)
              break
            }
          }
          break
        case VncConnection.STATE_NEED_CLIENT_VNC_AUTH:
          if ((chunk = this._consume(16))) {
            this._auth(VncConnection.SECURITY_VNC, {
              response: chunk
            })
            return
          }
          break
        case VncConnection.STATE_NEED_CLIENT_INIT:
          if ((chunk = this._consume(1))) {
            this._clientShare = chunk[0]!
            debug('client shareFlag', this._clientShare)
            this._writeServerInit()
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE:
          if ((chunk = this._consume(1))) {
            switch (chunk[0]) {
            case VncConnection.CLIENT_MESSAGE_SETPIXELFORMAT:
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_SETPIXELFORMAT)
              break
            case VncConnection.CLIENT_MESSAGE_SETENCODINGS:
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_SETENCODINGS)
              break
            case VncConnection.CLIENT_MESSAGE_FBUPDATEREQUEST:
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_FBUPDATEREQUEST)
              break
            case VncConnection.CLIENT_MESSAGE_KEYEVENT:
              this.emit('userActivity')
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_KEYEVENT)
              break
            case VncConnection.CLIENT_MESSAGE_POINTEREVENT:
              this.emit('userActivity')
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_POINTEREVENT)
              break
            case VncConnection.CLIENT_MESSAGE_CLIENTCUTTEXT:
              this.emit('userActivity')
              this._changeState(
                VncConnection.STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT)
              break
            default:
              this._error(new Error(util.format(
                'Unsupported message type %d', chunk[0])))
              return
            }
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_SETPIXELFORMAT:
          if ((chunk = this._consume(19))) {
            // [0b, 3b) padding
            this._clientPixelFormat = new PixelFormat({
              bitsPerPixel: chunk[3]!
            , depth: chunk[4]!
            , bigEndianFlag: chunk[5]!
            , trueColorFlag: chunk[6]!
            , redMax: chunk.readUInt16BE(7, true)
            , greenMax: chunk.readUInt16BE(9, true)
            , blueMax: chunk.readUInt16BE(11, true)
            , redShift: chunk[13]!
            , greenShift: chunk[14]!
            , blueShift: chunk[15]!
            })
            // [16b, 19b) padding
            debug('client pixel format', this._clientPixelFormat)
            this.emit('formatchange', this._clientPixelFormat)
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_SETENCODINGS:
          if ((chunk = this._consume(3))) {
            // [0b, 1b) padding
            this._clientEncodingCount = chunk.readUInt16BE(1, true)
            this._changeState(
              VncConnection.STATE_NEED_CLIENT_MESSAGE_SETENCODINGS_VALUE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_SETENCODINGS_VALUE:
          lo = 0
          hi = 4 * this._clientEncodingCount
          if ((chunk = this._consume(hi))) {
            this._clientEncodings = []
            while (lo < hi) {
              this._clientEncodings.push(chunk.readInt32BE(lo, true))
              lo += 4
            }
            debug('client encodings', this._clientEncodings)
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_FBUPDATEREQUEST:
          if ((chunk = this._consume(9))) {
            this.emit('fbupdaterequest', {
              incremental: chunk[0]!
            , xPosition: chunk.readUInt16BE(1, true)
            , yPosition: chunk.readUInt16BE(3, true)
            , width: chunk.readUInt16BE(5, true)
            , height: chunk.readUInt16BE(7, true)
            })
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_KEYEVENT:
          if ((chunk = this._consume(7))) {
            // downFlag = chunk[0]
            // [1b, 3b) padding
            // key = chunk.readUInt32BE(3, true)
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_POINTEREVENT:
          if ((chunk = this._consume(5))) {
            this.emit('pointer', {
              buttonMask: chunk[0]!
            , xPosition: chunk.readUInt16BE(1, true) / this._serverWidth
            , yPosition: chunk.readUInt16BE(3, true) / this._serverHeight
            })
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT:
          if ((chunk = this._consume(7))) {
            // [0b, 3b) padding
            this._clientCutTextLength = chunk.readUInt32BE(3)
            this._changeState(
              VncConnection.STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT_VALUE)
          }
          break
        case VncConnection.STATE_NEED_CLIENT_MESSAGE_CLIENTCUTTEXT_VALUE:
          if ((chunk = this._consume(this._clientCutTextLength))) {
            // value = chunk
            this._changeState(VncConnection.STATE_NEED_CLIENT_MESSAGE)
          }
          break
        default:
          throw new Error(util.format('Impossible state %d', this._state))
        }
      }
      while (chunk)
    }
  }

  _parseVersion(chunk: Buffer) {
    if (chunk.equals(Buffer.from('RFB 003.008\n'))) {
      return VncConnection.V3_008
    }

    if (chunk.equals(Buffer.from('RFB 003.007\n'))) {
      return VncConnection.V3_007
    }

    if (chunk.equals(Buffer.from('RFB 003.003\n'))) {
      return VncConnection.V3_003
    }

    return null
  }

  _parseSecurity(chunk: Buffer) {
    switch (chunk[0]) {
    case VncConnection.SECURITY_NONE:
    case VncConnection.SECURITY_VNC:
      return chunk[0]
    default:
      return null
    }
  }

  _changeState(state: number) {
    this._state = state
  }

  _append(chunk: Buffer | null) {
    if (!chunk) {
      return false
    }

    debug('in', chunk)

    if (this._buffer) {
      this._buffer = Buffer.concat(
        [this._buffer, chunk], this._buffer.length + chunk.length)
    }
    else {
      this._buffer = chunk
    }

    return true
  }

  _consume(n: number) {
    var chunk

    if (!this._buffer) {
      return null
    }

    if (n < this._buffer.length) {
      chunk = this._buffer.slice(0, n)
      this._buffer = this._buffer.slice(n)
      return chunk
    }

    if (n === this._buffer.length) {
      chunk = this._buffer
      this._buffer = null
      return chunk
    }

    return null
  }

  _write(chunk: Buffer) {
    debug('out', chunk)
    this.conn.write(chunk)
  }
}

export default VncConnection
