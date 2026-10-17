// WDA supplies Content-Length for each JPEG. Bound both the headers and the frame.
export class MjpegDecoder {
  private buffer = Buffer.alloc(0)
  private length = 0

  feed(chunk: Uint8Array): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: Buffer[] = []
    while (this.buffer.length) {
      if (!this.length) {
        // WDA appends two CRLFs after each JPEG; they can arrive in separate chunks.
        while (this.buffer.length >= 2 && this.buffer.readUInt16BE(0) === 0x0d0a) {
          this.buffer = this.buffer.subarray(2)
        }
        const end = this.buffer.indexOf('\r\n\r\n')
        if (end < 0) {
          if (this.buffer.length > 16384) {
            throw new Error('MJPEG headers exceed 16 KiB')
          }
          break
        }
        const headers = this.buffer.subarray(0, end).toString('ascii')
        const length = /(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(headers)
        this.length = Number(length?.[1])
        if (!Number.isInteger(this.length) || this.length < 4 || this.length > 8 * 1024 * 1024) {
          throw new Error('Invalid MJPEG frame length')
        }
        this.buffer = this.buffer.subarray(end + 4)
      }
      if (this.buffer.length < this.length) {
        break
      }
      const frame = this.buffer.subarray(0, this.length)
      if (frame.readUInt16BE(0) !== 0xffd8 || frame.readUInt16BE(frame.length - 2) !== 0xffd9) {
        throw new Error('Invalid MJPEG image')
      }
      frames.push(frame)
      this.buffer = this.buffer.subarray(this.length)
      this.length = 0
    }
    return frames
  }
}
