import stream from 'stream'

var HEADER_SIZE = 4
var MAX_PACKET_SIZE = 0xFFFF

class ForwardWriter extends stream.Transform {
  declare _target: number

  constructor(target: number) {
    super()
    this._target = target
  }

  _transform(fullChunk: Buffer, encoding: BufferEncoding, done: stream.TransformCallback) {
    var chunk = fullChunk
    var header, length

    do {
      length = Math.min(MAX_PACKET_SIZE, chunk.length)

      header = Buffer.alloc(HEADER_SIZE)
      header.writeUInt16LE(this._target, 0)
      header.writeUInt16LE(length, 2)

      this.push(header)
      this.push(chunk.slice(0, length))

      chunk = chunk.slice(length)
    }
    while (chunk.length)

    done()
  }

  _flush(done: stream.TransformCallback) {
    var header = Buffer.alloc(HEADER_SIZE)
    header.writeUInt16LE(this._target, 0)
    header.writeUInt16LE(0, 2)

    this.push(header)

    done()
  }
}

export default ForwardWriter
