import util from 'util'

interface ResourceOptions {
  src: string | null
  dest: string[]
  comm: string
  mode: number
}

class Resource {
  declare src: string | null
  declare dest: string
  declare comm: string
  declare mode: number
  declare fallback: string[]

  constructor(options: ResourceOptions) {
    this.src = options.src
    this.dest = options.dest.shift() as string
    this.comm = options.comm
    this.mode = options.mode
    this.fallback = options.dest
  }

  shift() {
    if (this.fallback.length === 0) {
      throw new Error(util.format(
        'Out of fallback locations for "%s"'
      , this.src
      ))
    }
    this.dest = this.fallback.shift() as string
  }
}

export default Resource
