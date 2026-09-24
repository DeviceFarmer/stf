export interface ScaledPoint {
  xP: number
  yP: number
}

export interface Size {
  width: number
  height: number
}

export function scalingCoordinator(realWidth: number, realHeight: number) {
  const realRatio = realWidth / realHeight

  return {
    coords(boundingW: number, boundingH: number, relX: number, relY: number, rotation: number): ScaledPoint {
      let w = boundingW
      let h = boundingH
      let x = relX
      let y = relY

      switch (rotation) {
        case 90:
          w = boundingH
          h = boundingW
          x = boundingH - relY
          y = relX
          break
        case 180:
          x = boundingW - relX
          y = boundingH - relY
          break
        case 270:
          w = boundingH
          h = boundingW
          x = relY
          y = boundingW - relX
          break
        default:
          break
      }

      const ratio = w / h

      if (realRatio > ratio) {
        const scaledValue = w / realRatio
        y -= (h - scaledValue) / 2
        y = Math.min(Math.max(y, 0), scaledValue)
        x = Math.min(Math.max(x, 0), w)
        h = scaledValue
      }
      else {
        const scaledValue = h * realRatio
        x -= (w - scaledValue) / 2
        x = Math.min(Math.max(x, 0), scaledValue)
        y = Math.min(Math.max(y, 0), h)
        w = scaledValue
      }

      return {xP: x / w, yP: y / h}
    }
    , size(sizeWidth: number, sizeHeight: number): Size {
      let width = sizeWidth
      let height = sizeHeight
      const ratio = width / height

      if (realRatio > ratio) {
        if (width >= realWidth) {
          width = realWidth
          height = realHeight
        }
        else {
          height = Math.floor(width / realRatio)
        }
      }
      else if (height >= realHeight) {
        height = realHeight
        width = realWidth
      }
      else {
        width = Math.floor(height * realRatio)
      }

      return {width, height}
    }
    , projectedSize(boundingW: number, boundingH: number, rotation: number): Size {
      const sideways = rotation === 90 || rotation === 270
      let w = sideways ? boundingH : boundingW
      let h = sideways ? boundingW : boundingH

      if (realRatio > w / h) {
        h = Math.floor(w / realRatio)
      }
      else {
        w = Math.floor(h * realRatio)
      }

      return {width: w, height: h}
    }
  }
}

export type ScalingCoordinator = ReturnType<typeof scalingCoordinator>
