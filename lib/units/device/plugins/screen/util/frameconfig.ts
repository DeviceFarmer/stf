import util from 'util'

interface FrameSize {
  width: number
  height: number
}

interface FrameGeometry extends FrameSize {
  rotation: number
}

class FrameConfig {
  declare realWidth: number
  declare realHeight: number
  declare virtualWidth: number
  declare virtualHeight: number
  declare rotation: number

  constructor(real: FrameSize, virtual: FrameGeometry) {
    this.realWidth = real.width
    this.realHeight = real.height
    this.virtualWidth = virtual.width
    this.virtualHeight = virtual.height
    this.rotation = virtual.rotation
  }

  toString() {
    return util.format(
      '%dx%d@%dx%d/%d'
    , this.realWidth
    , this.realHeight
    , this.virtualWidth
    , this.virtualHeight
    , this.rotation
    )
  }
}

export default FrameConfig
