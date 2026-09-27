import events from 'events'
import util from 'util'

interface Channel {
  timeout: number
  alias: string | undefined
  lastActivity: number
  timer: ReturnType<typeof setTimeout> | null
}

interface ChannelOptions {
  timeout: number
  alias?: string
}

class ChannelManager extends events.EventEmitter {
  declare channels: Record<string, Channel>

  constructor() {
    super()
    this.channels = Object.create(null)
  }

  register(id: string, options: ChannelOptions) {
    var channel = this.channels[id] = {
      timeout: options.timeout
    , alias: options.alias
    , lastActivity: Date.now()
    , timer: null
    }

    if (channel.alias) {
      // The alias can only be active for a single channel at a time
      if (this.channels[channel.alias]) {
        throw new Error(util.format(
          'Cannot create alias "%s" for "%s"; the channel already exists'
        , channel.alias
        , id
        ))
      }

      this.channels[channel.alias] = channel
    }

    // Set timer with initial check
    this.check(id)
  }

  unregister(id: string) {
    var channel = this.channels[id]
    if (channel) {
      delete this.channels[id]
      clearTimeout(channel.timer as ReturnType<typeof setTimeout>)
      if (channel.alias) {
        delete this.channels[channel.alias]
      }
    }
  }

  keepalive(id: string | Buffer) {
    var channel = this.channels[id as string]
    if (channel) {
      channel.lastActivity = Date.now()
    }
  }

  check(id: string) {
    var channel = this.channels[id]!
    var inactivePeriod = Date.now() - channel.lastActivity

    if (inactivePeriod >= channel.timeout) {
      this.unregister(id)
      this.emit('timeout', id)
    }
    else if (channel.timeout < Infinity) {
      channel.timer = setTimeout(
        this.check.bind(this, id)
      , channel.timeout - inactivePeriod
      )
    }
  }
}

export default ChannelManager
