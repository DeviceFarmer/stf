import type {Device} from '@/core/devices/types'
import {canViewDevice, isAutomated} from '@/core/devices/enhance'
import {rotator} from './rotator'
import {startHevcScreen, supportsHevcScreen} from './screen-hevc'

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

export type DisplayError = false | 'secure' | 'hevc-unsupported' | 'coredevice-unsupported' |
  'hevc-unavailable' | 'hevc-locked' | 'hevc-insecure' | 'hevc-automation'
export type ScreenStreamStatus = 'reconnecting' | 'disconnected' | 'offline' | null

export interface ScreenStreamOptions {
  url: string
  root: HTMLElement
  positioner: HTMLElement
  canvas: HTMLCanvasElement
  screen: ScreenGeometry
  getDevice: () => Device
  isShown: () => boolean
  canControl: () => boolean
  onDisplayError: (error: DisplayError) => void
  onFirstFrame: () => void
  onInputReady: (ready: boolean) => void
  onStatusChange: (status: ScreenStreamStatus) => void
}

export interface ScreenStream {
  checkEnabled: () => void
  resize: () => void
  retry: () => void
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

  let ws: WebSocket | null = null
  let finishHevcClose: (() => void) | null = null
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0
  let hevcRequested = false
  let awaitingLockStatus = false
  let observedAutomation = false
  let hevcInput: 'waiting' | 'available' | 'requested' = 'waiting'
  let hevc: ReturnType<typeof startHevcScreen> | null = null

  let adjustedBoundSize: BoundSize | null = null
  let cachedEnabled = false
  let canvasAspect = 1
  let parentAspect = 1
  let displayError: DisplayError = false
  let framesDrawn = 0
  let framesReceived = 0
  let newestDrawnFrame = 0
  let frameGeneration = 0
  let transportLost = false
  let streamStatus: ScreenStreamStatus = null

  function isOpen(): boolean {
    return ws !== null && ws.readyState === WebSocket.OPEN
  }

  function sendSize() {
    if (!isIPhone() && ws && isOpen() && adjustedBoundSize) {
      ws.send(`size ${adjustedBoundSize.w}x${adjustedBoundSize.h}`)
    }
  }

  function setDisplayError(error: DisplayError) {
    if (displayError === error) {
      return
    }
    displayError = error
    options.onDisplayError(error)
    updateStatus()
  }

  function updateStatus() {
    const device = getDevice()
    let next: ScreenStreamStatus = null
    if (!stopped && options.isShown() && !document.hidden && !displayError &&
      (device.using || isAutomated(device))) {
      if (!device.present || device.status !== 3 || !device.ready) {
        transportLost = true
        next = 'offline'
      }
      else if (transportLost) {
        next = device.platform === 'iOS' ? 'reconnecting' : 'disconnected'
      }
    }
    if (next !== streamStatus) {
      streamStatus = next
      options.onStatusChange(next)
    }
  }

  function clearFrame() {
    frameGeneration += 1
    g.clearRect(0, 0, canvas.width, canvas.height)
    root.classList.remove('has-frame')
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

  function shouldViewScreen(): boolean {
    return options.isShown() && canViewDevice(getDevice()) && !document.hidden
  }

  function shouldUpdateScreen(): boolean {
    return shouldViewScreen() && isOpen() &&
      (!isIPhone() || (!isLockedIPhone() && !isAutomated(getDevice())))
  }

  function isIPhone(): boolean {
    return getDevice().platform === 'iOS'
  }

  function isLockedIPhone(): boolean {
    return isIPhone() && getDevice().ios?.locked === true
  }

  function canControlIPhone(): boolean {
    const device = getDevice()
    return isIPhone() && device.using === true && !isAutomated(device) && options.canControl()
  }

  function requestHevcInput() {
    if (hevcInput === 'available' && canControlIPhone() && ws && isOpen()) {
      hevcInput = 'requested'
      ws.send('hevc ready')
    }
  }

  function closeHevc() {
    if (hevcInput === 'requested') {
      options.onInputReady(false)
    }
    hevcInput = 'waiting'
    hevcRequested = false
    hevc?.close()
    hevc = null
  }

  function closeSocket(waitForClose = false) {
    if (ws) {
      const socket = ws
      ws = null
      socket.onerror = socket.onclose = socket.onmessage = socket.onopen = null
      if (waitForClose) {
        // Wait for the peer to receive the preceding `off` before opening a new stream.
        const finish = () => {
          if (finishHevcClose === finish) {
            clearTimeout(deadline)
            socket.onclose = null
            finishHevcClose = null
            if (!stopped) {
              queueMicrotask(checkHevcEnabled)
            }
          }
        }
        const deadline = setTimeout(finish, 1000)
        finishHevcClose = socket.onclose = finish
      }
      socket.close()
    }
  }

  function cancelRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function closeHevcConnection() {
    const waitForClose = hevcRequested
    if (ws) {
      if (hevcRequested && isOpen()) {
        ws.send('off')
      }
      transportLost ||= hevc !== null
      clearFrame()
    }
    closeHevc()
    cancelRetry()
    closeSocket(waitForClose)
  }

  function hevcBlock(): DisplayError | undefined {
    if (!shouldViewScreen()) {
      return false
    }
    if (isAutomated(getDevice())) {
      return 'hevc-automation'
    }
    if (isLockedIPhone()) {
      return 'hevc-locked'
    }
    if (window.isSecureContext === false) {
      return 'hevc-insecure'
    }
    if (!supportsHevcScreen()) {
      return 'hevc-unsupported'
    }
    return undefined
  }

  function checkHevcEnabled() {
    if (stopped) {
      return
    }
    const block = hevcBlock()
    if (typeof block !== 'undefined') {
      observedAutomation = block === 'hevc-automation'
      awaitingLockStatus = false
      closeHevcConnection()
      setDisplayError(block)
      updateStatus()
      return
    }
    if (displayError === 'hevc-locked' || (observedAutomation && displayError === 'hevc-automation')) {
      setDisplayError(false)
    }
    observedAutomation = false
    if (displayError === 'hevc-unavailable' && awaitingLockStatus && getDevice().ios?.locked === false) {
      awaitingLockStatus = false
      setDisplayError(false)
    }
    if (hevcInput === 'requested' && !canControlIPhone()) {
      closeHevcConnection()
    }
    updateStatus()
    if (!displayError && updateBounds() && !ws && !finishHevcClose && !retryTimer) {
      connect()
    }
    requestHevcInput()
  }

  function checkEnabled() {
    if (isIPhone()) {
      checkHevcEnabled()
      return
    }
    const newEnabled = shouldUpdateScreen()
    updateStatus()
    if (newEnabled === cachedEnabled) {
      updateBounds()
    }
    else if (newEnabled) {
      if (!updateBounds() || !ws) {
        return
      }
      sendSize()
      ws.send('on')
    }
    else {
      clearFrame()
      if (ws && isOpen()) {
        ws.send('off')
      }
    }

    cachedEnabled = newEnabled
  }

  function maybeFlipLetterbox() {
    root.classList.toggle('letterboxed', parentAspect < canvasAspect)
  }

  const cachedScreen: ScreenGeometry = {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
  let cachedImageWidth = 0
  let cachedImageHeight = 0
  let cachedImageScale = 0
  let cssRotation = 0
  let alwaysUpright = false

  function applyQuirks(banner: {quirks: {alwaysUpright: boolean}}) {
    alwaysUpright = banner.quirks.alwaysUpright
    root.classList.toggle('quirk-always-upright', alwaysUpright)
  }

  function hasImageAreaChanged(width: number, height: number, scale: number): boolean {
    return cachedScreen.bounds.w !== screen.bounds.w ||
      cachedScreen.bounds.h !== screen.bounds.h ||
      cachedImageWidth !== width ||
      cachedImageHeight !== height ||
      cachedImageScale !== scale ||
      cachedScreen.rotation !== screen.rotation
  }

  function updateImageArea(width: number, height: number, scale: number) {
    if (!hasImageAreaChanged(width, height, scale)) {
      return
    }

    cachedImageWidth = width
    cachedImageHeight = height
    cachedImageScale = scale

    if (streamOptions.autoScaleForRetina) {
      canvas.width = cachedImageWidth * scale
      canvas.height = cachedImageHeight * scale
      g.scale(scale, scale)
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
      canvasAspect = height / width
      root.classList.add('rotated')
    }
    else {
      canvasAspect = width / height
      root.classList.remove('rotated')
    }

    if (alwaysUpright) {
      positioner.style.transform = `rotate(${-cssRotation}deg)`
    }

    maybeFlipLetterbox()
  }

  function drawImage(image: CanvasImageSource, width: number, height: number, scale = frontBackRatio) {
    updateImageArea(width, height, scale)
    g.drawImage(image, 0, 0, width, height)
    transportLost = false
    if (displayError) {
      setDisplayError(false)
    }
    updateStatus()
    root.classList.add('has-frame')
    if (framesDrawn++ === 0) {
      options.onFirstFrame()
    }
  }

  function drawFrame(data: Blob, socket: WebSocket) {
    framesReceived += 1
    const frame = framesReceived
    const generation = frameGeneration

    createImageBitmap(data)
      .then((bitmap) => {
        if (ws !== socket || generation !== frameGeneration || !shouldUpdateScreen() ||
          frame < newestDrawnFrame) {
          bitmap.close()
          return
        }
        newestDrawnFrame = frame
        try {
          drawImage(bitmap, bitmap.width, bitmap.height)
        }
        finally {
          bitmap.close()
        }
      })
      .catch(() => undefined)
  }

  function failHevc(error: Exclude<DisplayError, false | 'secure'>) {
    closeHevcConnection()
    setDisplayError(error)
    if (awaitingLockStatus && getDevice().ios?.locked === false) {
      checkHevcEnabled()
    }
  }

  function openHevc(header: string, socket: WebSocket) {
    if (hevc || !hevcRequested || !shouldUpdateScreen()) {
      return
    }
    frameGeneration += 1
    const session = startHevcScreen(header, {
      onFrame: (frame) => {
        if (hevc !== session || ws !== socket || !shouldUpdateScreen()) {
          return
        }
        const device = getDevice()
        const display = device.display
        const width = display?.width || frame.displayWidth
        const height = display?.height || frame.displayHeight
        if ((width > height) !== (frame.displayWidth > frame.displayHeight)) {
          failHevc('hevc-unavailable')
          return
        }
        // Keep the canvas aligned with touch coordinates as the encoder changes resolution.
        drawImage(frame, width, height, 1)
        awaitingLockStatus = false
        if (hevcInput === 'waiting') {
          hevcInput = 'available'
          requestHevcInput()
        }
      }
      , onKeyframe: () => {
        if (hevc === session && ws === socket && shouldUpdateScreen()) {
          socket.send('hevc keyframe')
        }
      }
      , onError: reason => {
        if (hevc === session && ws === socket && shouldUpdateScreen()) {
          failHevc(reason === 'unsupported' ? 'hevc-unsupported' : 'hevc-unavailable')
        }
      }
    })
    hevc = session
  }

  function connect() {
    const socket = new WebSocket(options.url)
    const native = isIPhone()
    socket.binaryType = native ? 'arraybuffer' : 'blob'
    ws = socket
    socket.onmessage = (message: MessageEvent) => {
      if (ws !== socket || stopped) {
        return
      }
      const display = getDevice().display
      screen.rotation = display ? display.rotation : 0

      if (message.data instanceof ArrayBuffer) {
        if (hevc && shouldUpdateScreen()) {
          hevc.receive(message.data)
        }
      }
      else if (message.data instanceof Blob) {
        if (!isIPhone() && shouldUpdateScreen()) {
          drawFrame(message.data, socket)
        }
      }
      else if (message.data === 'hevc input ready') {
        if (hevcInput === 'requested' && canControlIPhone() && shouldUpdateScreen()) {
          options.onInputReady(true)
        }
      }
      else if (message.data === 'hevc automation') {
        if (hevcRequested) {
          failHevc('hevc-automation')
        }
      }
      else if (message.data === 'hevc unsupported' || message.data === 'hevc unavailable') {
        if (hevcRequested && shouldUpdateScreen()) {
          const error = message.data === 'hevc unsupported' ? 'coredevice-unsupported' : 'hevc-unavailable'
          failHevc(error)
        }
      }
      else if (typeof message.data === 'string' && message.data.startsWith('hevc ')) {
        openHevc(message.data.slice('hevc '.length), socket)
      }
      else if (/^start /.test(message.data)) {
        applyQuirks(JSON.parse(message.data.slice('start '.length)))
      }
      else if (!isIPhone() && message.data === 'secure_on') {
        clearFrame()
        setDisplayError('secure')
      }
    }

    socket.onopen = () => {
      if (ws !== socket || stopped) {
        return
      }
      retryAttempt = 0
      if (native) {
        checkHevcEnabled()
        if (ws === socket) {
          // Native status, frames and input acknowledgement belong to this socket only.
          awaitingLockStatus = getDevice().ios?.locked !== false
          hevcRequested = true
          socket.send('hevc')
          socket.send('on')
        }
        return
      }
      cachedEnabled = false
      checkEnabled()
    }
    socket.onclose = () => {
      if (ws !== socket || stopped) {
        return
      }
      ws = null
      closeHevc()
      cachedEnabled = false
      transportLost = true
      clearFrame()
      updateStatus()
      if (native) {
        scheduleRetry()
      }
    }
    socket.onerror = () => {
      if (ws === socket && !stopped) {
        closeHevc()
        transportLost = true
        clearFrame()
        updateStatus()
      }
    }
  }

  function scheduleRetry() {
    // A recovered iPhone may register before Kubernetes has restored its screen route.
    if (!stopped && !ws && !retryTimer && !displayError && typeof hevcBlock() === 'undefined') {
      retryTimer = setTimeout(() => {
        retryTimer = null
        checkHevcEnabled()
      }, Math.min(5000, 500 * 2 ** Math.min(4, retryAttempt++)))
    }
  }

  function resize() {
    parentAspect = root.offsetWidth / root.offsetHeight
    maybeFlipLetterbox()
  }

  function retry() {
    if (displayError === 'hevc-unavailable' && typeof hevcBlock() === 'undefined') {
      transportLost = true
      setDisplayError(false)
      checkHevcEnabled()
    }
  }

  function stop() {
    stopped = true
    closeHevc()
    clearFrame()
    updateStatus()
    cancelRetry()
    closeSocket()
    finishHevcClose?.()
  }

  if (isIPhone()) {
    checkHevcEnabled()
  }
  else {
    connect()
  }
  resize()

  return {checkEnabled, resize, retry, stop}
}
