const maxUnitBytes = 8 * 1024 * 1024

/** Each unit is a big-endian length, a frame type and a length-prefixed HEVC payload. */
export class CoreDeviceScreenDecoder {
  private buffer = Buffer.alloc(0)

  feed(chunk: Uint8Array) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const units: Buffer[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE()
      if (length < 7 || length > maxUnitBytes) {
        throw new Error('Invalid CoreDevice access unit length')
      }
      if (this.buffer.length < length + 4) {
        break
      }
      const unit = this.buffer.subarray(4, length + 4)
      if (unit[0]! > 2) {
        throw new Error('Invalid CoreDevice access unit type')
      }
      units.push(unit)
      this.buffer = this.buffer.subarray(length + 4)
    }
    return units
  }
}
