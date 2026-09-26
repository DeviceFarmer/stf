import EventEmitter from 'eventemitter3'

class FailCounter extends EventEmitter.EventEmitter {
  declare threshold: number
  declare time: number
  declare values: number[]

  constructor(threshold: number, time: number) {
    super()
    this.threshold = threshold
    this.time = time
    this.values = []
  }

  inc() {
    var now = Date.now()

    while (this.values.length) {
      if (now - this.values[0]! >= this.time) {
        this.values.shift()
      }
      else {
        break
      }
    }

    this.values.push(now)

    if (this.values.length > this.threshold) {
      this.emit('exceedLimit', this.threshold, this.time)
    }
  }
}

export default FailCounter
