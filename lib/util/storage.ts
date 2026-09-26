import events from 'events'
import fs from 'fs'

import * as uuid from 'uuid'

interface StoredFile {
  name?: string | null
  path: string
  type?: string | null
  isAab?: boolean | undefined
}

interface StoredEntry {
  timeout: number
  lastActivity: number
  data: StoredFile
}

class Storage extends events.EventEmitter {
  declare files: Record<string, StoredEntry>
  declare timer: ReturnType<typeof setInterval>

  constructor() {
    super()
    this.files = Object.create(null)
    this.timer = setInterval(this.check.bind(this), 60000)
  }

  store(file: StoredFile) {
    var id = uuid.v4()
    this.set(id, file)
    return id
  }

  set(id: string, file: StoredFile) {
    this.files[id] = {
      timeout: 600000
    , lastActivity: Date.now()
    , data: file
    }

    return file
  }

  remove(id: string) {
    var file = this.files[id]
    if (file) {
      delete this.files[id]
      fs.unlink(file.data.path, function() {})
    }
  }

  retrieve(id: string) {
    var file = this.files[id]
    if (file) {
      file.lastActivity = Date.now()
      return file.data
    }
    return null
  }

  check() {
    var now = Date.now()

    Object.keys(this.files).forEach(function(this: Storage, id) {
      var file = this.files[id]!
      var inactivePeriod = now - file.lastActivity

      if (inactivePeriod >= file.timeout) {
        this.remove(id)
        this.emit('timeout', id, file.data)
      }
    }, this)
  }

  stop() {
    clearInterval(this.timer)
  }
}

export default Storage
