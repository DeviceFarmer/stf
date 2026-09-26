import EventEmitter from 'eventemitter3'

interface BroadcastSetEvents {
  insert: (id: string) => void
  remove: (id: string) => void
  nonempty: () => void
  empty: () => void
}

class BroadcastSet<T> extends EventEmitter.EventEmitter<BroadcastSetEvents> {
  declare set: Record<string, T>
  declare count: number

  constructor() {
    super()
    this.set = Object.create(null)
    this.count = 0
  }

  insert(id: string, ws: T) {
    if (!(id in this.set)) {
      this.set[id] = ws
      this.count += 1
      this.emit('insert', id)
      if (this.count === 1) {
        this.emit('nonempty')
      }
    }
  }

  remove(id: string) {
    if (id in this.set) {
      delete this.set[id]
      this.count -= 1
      this.emit('remove', id)
      if (this.count === 0) {
        this.emit('empty')
      }
    }
  }

  values() {
    return Object.keys(this.set).map(function(this: BroadcastSet<T>, id) {
      return this.set[id]
    }, this)
  }

  keys() {
    return Object.keys(this.set)
  }

  get(id: string) {
    return this.set[id]
  }
}

export default BroadcastSet
