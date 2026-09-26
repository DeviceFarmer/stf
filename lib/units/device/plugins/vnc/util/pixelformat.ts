interface PixelFormatValues {
  bitsPerPixel: number
  depth: number
  bigEndianFlag: number
  trueColorFlag: number
  redMax: number
  greenMax: number
  blueMax: number
  redShift: number
  greenShift: number
  blueShift: number
}

class PixelFormat {
  declare bitsPerPixel: number
  declare depth: number
  declare bigEndianFlag: number
  declare trueColorFlag: number
  declare redMax: number
  declare greenMax: number
  declare blueMax: number
  declare redShift: number
  declare greenShift: number
  declare blueShift: number

  constructor(values: PixelFormatValues) {
    this.bitsPerPixel = values.bitsPerPixel
    this.depth = values.depth
    this.bigEndianFlag = values.bigEndianFlag
    this.trueColorFlag = values.trueColorFlag
    this.redMax = values.redMax
    this.greenMax = values.greenMax
    this.blueMax = values.blueMax
    this.redShift = values.redShift
    this.greenShift = values.greenShift
    this.blueShift = values.blueShift
  }
}

export default PixelFormat
