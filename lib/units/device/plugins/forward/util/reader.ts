import stream from 'stream'

var HEADER_SIZE = 4

class ForwardReader extends stream.Transform {
  declare _header: Buffer
  declare _needLength: number
  declare _target: number

  constructor() {
    super()
    this._header = Buffer.alloc(HEADER_SIZE)
    this._needLength = -HEADER_SIZE
    this._target = 0
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: stream.TransformCallback) {
    var cursor = 0

    while (cursor < chunk.length) {
      var diff = chunk.length - cursor

      // Do we need a header?
      if (this._needLength < 0) {
        // Still missing a header?
        if (chunk.length < -this._needLength) {
          // Save what we're received so far.
          chunk.copy(
            this._header
          , HEADER_SIZE + this._needLength
          , cursor
          , cursor + -this._needLength
          )
          break
        }

        // Combine previous and current chunk in case the header was split.
        chunk.copy(
          this._header
        , HEADER_SIZE + this._needLength
        , cursor
        , cursor + -this._needLength
        )

        cursor += -this._needLength

        this._target = this._header.readUInt16LE(0)
        this._needLength = this._header.readUInt16LE(2)

        if (this._needLength === 0) {
          // This is a fin packet
          this.emit('packet', this._target, null)
          this._needLength = -HEADER_SIZE
        }
      }
      // Do we have a full data packet?
      else if (diff >= this._needLength) {
        this.emit(
          'packet'
        , this._target
        , chunk.slice(cursor, cursor + this._needLength)
        )
        cursor += this._needLength
        this._needLength = -HEADER_SIZE
      }
      // We have a partial data packet.
      else {
        this.emit('packet', this._target, chunk.slice(cursor, cursor + diff))
        this._needLength -= diff
        cursor += diff
      }
    }

    done()
  }
}

export default ForwardReader
