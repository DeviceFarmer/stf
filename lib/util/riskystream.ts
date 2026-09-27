import Promise from 'bluebird'
import EventEmitter from 'eventemitter3'
import type {Duplex} from 'stream'

class RiskyStream extends EventEmitter.EventEmitter {
  declare endListener: () => void
  declare stream: Duplex
  declare expectingEnd: boolean
  declare ended: boolean

  constructor(stream: Duplex) {
    super()

    this.endListener = function(this: RiskyStream) {
      this.ended = true
      this.stream.removeListener('end', this.endListener)

      if (!this.expectingEnd) {
        this.emit('unexpectedEnd')
      }

      this.emit('end')
    }.bind(this)

    this.stream = stream
      .on('end', this.endListener)
    this.expectingEnd = false
    this.ended = false
  }

  end() {
    this.expectEnd()
    return this.stream.end()
  }

  expectEnd() {
    this.expectingEnd = true
    return this
  }

  waitForEnd() {
    var stream = this.stream
    var endListener: () => void

    this.expectEnd()

    if (this.ended) {
      return Promise.resolve(true)
    }

    return new Promise(function(resolve) {
        stream.on('end', endListener = function() {
          resolve(true)
        })

        // Make sure we actually have a chance to get the 'end' event.
        stream.resume()
      })
      .finally(function() {
        stream.removeListener('end', endListener)
      })
  }
}

export default RiskyStream
