//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import stream from 'stream'

class DelimitedStream extends stream.Transform {
  declare _length: number
  declare _lengthIndex: number
  declare _readingLength: boolean
  declare _buffer: Buffer

  constructor() {
    super()
    this._length = 0
    this._lengthIndex = 0
    this._readingLength = true
    this._buffer = Buffer.alloc(0)
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: stream.TransformCallback) {
    this._buffer = Buffer.concat([this._buffer, chunk])

    while (this._buffer.length) {
      if (this._readingLength) {
        var byte = this._buffer[0]!
        this._length += (byte & 0x7f) << (7 * this._lengthIndex)
        if (byte & (1 << 7)) {
          this._lengthIndex += 1
          this._readingLength = true
        }
        else {
          this._lengthIndex = 0
          this._readingLength = false
        }
        this._buffer = this._buffer.slice(1)
      }
      else {
        if (this._length <= this._buffer.length) {
          this.push(this._buffer.slice(0, this._length))
          this._buffer = this._buffer.slice(this._length)
          this._length = 0
          this._readingLength = true
        }
        else {
          // Wait for more chunks
          break
        }
      }
    }

    done()
  }
}

class DelimitingStream extends stream.Transform {
  constructor() {
    super()
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, done: stream.TransformCallback) {
    var length = chunk.length
    var lengthBytes: number[] = []

    while (length > 0x7f) {
      lengthBytes.push((1 << 7) + (length & 0x7f))
      length >>= 7
    }

    lengthBytes.push(length)

    this.push(Buffer.from(lengthBytes))
    this.push(chunk)

    done()
  }
}

export default {DelimitedStream, DelimitingStream}
