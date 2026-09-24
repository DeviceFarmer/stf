import type {Device} from '@/core/devices/types'
import {rotator} from './rotator'

export interface ScreenBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface ScreenGeometry {
  rotation: number
  bounds: ScreenBounds
}

export type DisplayError = false | 'secure'

export interface ScreenStreamOptions {
  url: string
  root: HTMLElement
  positioner: HTMLElement
  canvas: HTMLCanvasElement
  screen: ScreenGeometry
  getDevice: () => Device
  isShown: () => boolean
  onDisplayError: (error: DisplayError) => void
  onFirstFrame: () => void
}

export interface ScreenStream {
  checkEnabled: () => void
  resize: () => void
  stop: () => void
}

interface BoundSize {
  w: number
  h: number
}

const streamOptions = {
  autoScaleForRetina: true
  , density: Math.max(1, Math.min(1.5, window.devicePixelRatio || 1))
  , minscale: 0.36
}

function vendorBackingStorePixelRatio(g: CanvasRenderingContext2D): number {
  const vendor = g as unknown as Record<string, number | undefined>
  return vendor.webkitBackingStorePixelRatio ||
    vendor.mozBackingStorePixelRatio ||
    vendor.msBackingStorePixelRatio ||
    vendor.oBackingStorePixelRatio ||
    vendor.backingStorePixelRatio || 1
}

function isSideways(rotation: number): boolean {
  return rotation === 90 || rotation === 270
}

export function startScreenStream(options: ScreenStreamOptions): ScreenStream {
  const {root, positioner, canvas, screen, getDevice} = options
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const devicePixelRatio = window.devicePixelRatio || 1
  const frontBackRatio = devicePixelRatio / vendorBackingStorePixelRatio(g)

  let ws: WebSocket | null = new WebSocket(options.url)
  ws.binaryType = 'blob'

  let adjustedBoundSize: BoundSize | null = null
  let cachedEnabled = false
  let canvasAspect = 1
  let parentAspect = 1
  let displayError: DisplayError = false
  let framesDrawn = 0
  let framesReceived = 0
  let newestDrawnFrame = 0

  function isOpen(): boolean {
    return ws !== null && ws.readyState === WebSocket.OPEN
  }

  function sendSize() {
    if (ws && isOpen() && adjustedBoundSize) {
      ws.send(`size ${adjustedBoundSize.w}x${adjustedBoundSize.h}`)
    }
  }

  function setDisplayError(error: DisplayError) {
    displayError = error
    options.onDisplayError(error)
  }

  function adjustBoundedSize(w: number, h: number): BoundSize {
    const display = getDevice().display
    const displayWidth = display ? display.width : 0
    const displayHeight = display ? display.height : 0
    let sw = w * streamOptions.density
    let sh = h * streamOptions.density
    let f = displayWidth * streamOptions.minscale

    if (sw < f) {
      sw *= f / sw
      sh *= f / sh
    }

    f = displayHeight * streamOptions.minscale
    if (sh < f) {
      sw *= f / sw
      sh *= f / sh
    }

    const fitsDisplay = displayWidth && displayHeight ?
      Math.min(1, Math.max(displayWidth / sw, displayHeight / sh)) :
      1

    return {w: Math.ceil(sw * fitsDisplay), h: Math.ceil(sh * fitsDisplay)}
  }

  function updateBounds(): boolean {
    const w = screen.bounds.w = root.offsetWidth
    const h = screen.bounds.h = root.offsetHeight

    if (!w || !h) {
      return false
    }

    const next = isSideways(screen.rotation) ? adjustBoundedSize(h, w) : adjustBoundedSize(w, h)

    if (!adjustedBoundSize || next.w !== adjustedBoundSize.w || next.h !== adjustedBoundSize.h) {
      adjustedBoundSize = next
      sendSize()
    }
    return true
  }

  function shouldUpdateScreen(): boolean {
    return options.isShown() &&
      Boolean(getDevice().using) &&
      !document.hidden &&
      isOpen()
  }

  function onScreenInterestGained() {
    if (ws && isOpen()) {
      sendSize()
      ws.send('on')
    }
  }

  function onScreenInterestLost() {
    if (ws && isOpen()) {
      ws.send('off')
    }
  }

  function checkEnabled() {
    const newEnabled = shouldUpdateScreen()

    if (newEnabled === cachedEnabled) {
      updateBounds()
    }
    else if (newEnabled) {
      if (!updateBounds()) {
        return
      }
      onScreenInterestGained()
    }
    else {
      g.clearRect(0, 0, canvas.width, canvas.height)
      onScreenInterestLost()
    }

    cachedEnabled = newEnabled
  }

  function maybeFlipLetterbox() {
    root.classList.toggle('letterboxed', parentAspect < canvasAspect)
  }

  const cachedScreen: ScreenGeometry = {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
  let cachedImageWidth = 0
  let cachedImageHeight = 0
  let cssRotation = 0
  let alwaysUpright = false

  function applyQuirks(banner: {quirks: {alwaysUpright: boolean}}) {
    alwaysUpright = banner.quirks.alwaysUpright
    root.classList.toggle('quirk-always-upright', alwaysUpright)
  }

  function hasImageAreaChanged(img: ImageBitmap): boolean {
    return cachedScreen.bounds.w !== screen.bounds.w ||
      cachedScreen.bounds.h !== screen.bounds.h ||
      cachedImageWidth !== img.width ||
      cachedImageHeight !== img.height ||
      cachedScreen.rotation !== screen.rotation
  }

  function updateImageArea(img: ImageBitmap) {
    if (!hasImageAreaChanged(img)) {
      return
    }

    cachedImageWidth = img.width
    cachedImageHeight = img.height

    if (streamOptions.autoScaleForRetina) {
      canvas.width = cachedImageWidth * frontBackRatio
      canvas.height = cachedImageHeight * frontBackRatio
      g.scale(frontBackRatio, frontBackRatio)
    }
    else {
      canvas.width = cachedImageWidth
      canvas.height = cachedImageHeight
    }

    cssRotation += rotator(cachedScreen.rotation, screen.rotation)
    canvas.style.transform = `rotate(${cssRotation}deg)`

    cachedScreen.bounds.h = screen.bounds.h
    cachedScreen.bounds.w = screen.bounds.w
    cachedScreen.rotation = screen.rotation

    if (isSideways(screen.rotation) && !alwaysUpright) {
      canvasAspect = img.height / img.width
      root.classList.add('rotated')
    }
    else {
      canvasAspect = img.width / img.height
      root.classList.remove('rotated')
    }

    if (alwaysUpright) {
      positioner.style.transform = `rotate(${-cssRotation}deg)`
    }

    maybeFlipLetterbox()
  }

  function drawFrame(data: Blob) {
    if (displayError) {
      setDisplayError(false)
    }

    framesReceived += 1
    const frame = framesReceived

    createImageBitmap(data)
      .then((bitmap) => {
        if (!ws || frame < newestDrawnFrame) {
          bitmap.close()
          return
        }
        newestDrawnFrame = frame
        updateImageArea(bitmap)
        g.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
        bitmap.close()
        if (framesDrawn++ === 0) {
          root.classList.add('has-frame')
          options.onFirstFrame()
        }
      })
      .catch(() => undefined)
  }

  ws.onmessage = (message: MessageEvent) => {
    const display = getDevice().display
    screen.rotation = display ? display.rotation : 0

    if (message.data instanceof Blob) {
      if (shouldUpdateScreen()) {
        drawFrame(message.data)
      }
    }
    else if (/^start /.test(message.data)) {
      applyQuirks(JSON.parse(message.data.slice('start '.length)))
    }
    else if (message.data === 'secure_on') {
      setDisplayError('secure')
    }
  }

  ws.onopen = () => {
    checkEnabled()
  }

  function resize() {
    parentAspect = root.offsetWidth / root.offsetHeight
    maybeFlipLetterbox()
  }

  function stop() {
    if (!ws) {
      return
    }
    const socket = ws
    ws = null
    socket.onerror = socket.onclose = socket.onmessage = socket.onopen = null
    socket.close()
  }

  resize()

  return {checkEnabled, resize, stop}
}
