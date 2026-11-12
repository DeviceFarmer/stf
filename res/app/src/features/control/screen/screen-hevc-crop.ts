const PROBE_HEIGHT = 192

export interface HevcCrop {
  width: number
  height: number
}

function contentEdge(pixels: Uint8ClampedArray, lines: number, lineLength: number,
  lineStride: number, pixelStride: number): number {
  const minimumContent = Math.ceil(lineLength * 0.4)
  for (let line = lines - 1; line >= lines * 0.2; line -= 1) {
    let content = 0
    for (let pixel = 0; pixel < lineLength; pixel += 1) {
      const offset = (line * lineStride + pixel * pixelStride) * 4
      if (Math.abs(pixels[offset]! - 128) >= 6 || Math.abs(pixels[offset + 1]! - 128) >= 6 ||
        Math.abs(pixels[offset + 2]! - 128) >= 6) {
        content += 1
        if (content >= minimumContent) {
          return line + 1
        }
      }
    }
  }
  return 0
}

export function createHevcCropDetector(document: Document): (frame: VideoFrame) => HevcCrop | null {
  const probe = document.createElement('canvas')
  const context = probe.getContext('2d', {willReadFrequently: true})

  return frame => {
    if (!context || !frame.displayWidth || !frame.displayHeight) {
      return null
    }

    // CoreDevice can shrink the whole screen into the top-left of a frame
    // without changing its dimensions. Probe a small copy for its gray padding.
    const width = Math.max(8, Math.round(PROBE_HEIGHT * frame.displayWidth / frame.displayHeight))
    if (probe.width !== width || probe.height !== PROBE_HEIGHT) {
      probe.width = width
      probe.height = PROBE_HEIGHT
    }
    try {
      context.drawImage(frame, 0, 0, width, PROBE_HEIGHT)
      const pixels = context.getImageData(0, 0, width, PROBE_HEIGHT).data
      const right = contentEdge(pixels, width, PROBE_HEIGHT, 1, width)
      if (right <= width * 0.2 || right >= width * 0.92) {
        return null
      }
      const bottom = contentEdge(pixels, PROBE_HEIGHT, width, width, 1)
      if (bottom <= PROBE_HEIGHT * 0.2 || bottom >= PROBE_HEIGHT * 0.92) {
        return null
      }
      return {
        width: Math.round((right - 0.5) * frame.displayWidth / width)
        , height: Math.round((bottom - 0.5) * frame.displayHeight / PROBE_HEIGHT)
      }
    }
    catch {
      return null
    }
  }
}
