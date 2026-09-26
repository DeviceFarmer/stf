import EventEmitter from 'eventemitter3'

class TtlItem {
  declare next: TtlItem | null
  declare prev: TtlItem | null
  declare time: number | null
  declare value: string | number

  constructor(value: string | number) {
    this.next = null
    this.prev = null
    this.time = null
    this.value = value
  }
}

class TtlSet extends EventEmitter.EventEmitter {
  static SILENT = 1

  declare head: TtlItem | null
  declare tail: TtlItem | null
  declare mapping: Record<string, TtlItem>
  declare ttl: number
  declare timer: ReturnType<typeof setTimeout> | null

  constructor(ttl: number) {
    super()
    this.head = null
    this.tail = null
    this.mapping = Object.create(null)
    this.ttl = ttl
    this.timer = null
  }

  bump(value: string | number, time?: number, flags?: number) {
    var item = this._remove(this.mapping[value]) || this._create(value, flags)

    item.time = time || Date.now()
    item.prev = this.tail

    this.tail = item

    if (item.prev) {
      item.prev.next = item
    }
    else {
      this.head = item
      this._scheduleCheck()
    }
  }

  drop(value: string | number, flags?: number) {
    this._drop(this.mapping[value], flags)
  }

  stop() {
    clearTimeout(this.timer as ReturnType<typeof setTimeout>)
  }

  _scheduleCheck() {
    clearTimeout(this.timer as ReturnType<typeof setTimeout>)
    if (this.head) {
      var delay = Math.max(0, this.ttl - (Date.now() - this.head.time!))
      this.timer = setTimeout(this._check.bind(this), delay)
    }
  }

  _check() {
    var now = Date.now()

    var item: TtlItem | null
    while ((item = this.head)) {
      if (now - item.time! > this.ttl) {
        this._drop(item, 0)
      }
      else {
        break
      }
    }

    this._scheduleCheck()
  }

  _create(value: string | number, flags: number | undefined) {
    var item = new TtlItem(value)

    this.mapping[value] = item

    if ((flags! & TtlSet.SILENT) !== TtlSet.SILENT) {
      this.emit('insert', value)
    }

    return item
  }

  _drop(item: TtlItem | null | undefined, flags: number | undefined) {
    if (item) {
      this._remove(item)

      delete this.mapping[item.value]

      if ((flags! & TtlSet.SILENT) !== TtlSet.SILENT) {
        this.emit('drop', item.value)
      }
    }
  }

  _remove(item: TtlItem | null | undefined) {
    if (!item) {
      return null
    }

    if (item.prev) {
      item.prev.next = item.next
    }

    if (item.next) {
      item.next.prev = item.prev
    }

    if (item === this.head) {
      this.head = item.next
    }

    if (item === this.tail) {
      this.tail = item.prev
    }

    item.next = item.prev = null

    return item
  }
}

export default TtlSet
