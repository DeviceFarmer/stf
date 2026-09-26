class StateQueue {
  declare queue: number[]

  constructor() {
    this.queue = []
  }

  next() {
    return this.queue.shift()
  }

  empty() {
    return this.queue.length === 0
  }

  push(state: number) {
    var found = false

    // Not super efficient, but this shouldn't be running all the time anyway.
    for (var i = 0, l = this.queue.length; i < l; ++i) {
      if (this.queue[i] === state) {
        this.queue.splice(i + 1)
        found = true
        break
      }
    }

    if (!found) {
      this.queue.push(state)
    }
  }
}

export default StateQueue
