import type {Device} from '@/core/devices/types'
import {canViewDevice, isAutomated} from '@/core/devices/enhance'
import {scalingCoordinator, type ScalingCoordinator} from '@/core/scaling'
import {rotator} from './rotator'
import {startHevcScreen, supportsHevcScreen} from './screen-hevc'
import type {AndroidDisplayTarget, Fold4PostureMode} from '../../../../../../lib/types/android-display'
import {isFold4PostureMode} from '../../../../../../lib/util/displayutil'

export interface ScreenBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface ScreenGeometry {
  rotation: number
  bounds: ScreenBounds
  inputScaler?: ScalingCoordinator
}

export type DisplayError = false | 'secure' | 'hevc-unsupported' | 'coredevice-unsupported' |
  'hevc-unavailable' | 'hevc-locked' | 'hevc-insecure' | 'hevc-automation'
export type ScreenStreamStatus = 'reconnecting' | 'disconnected' | 'offline' | null

export interface AndroidDisplayState {
  selected: AndroidDisplayTarget
  singleTouch: boolean
  posture?: Fold4PostureMode
}

export interface ScreenStreamOptions {
  url: string
  root: HTMLElement
  positioner: HTMLElement
  canvas: HTMLCanvasElement
  screen: ScreenGeometry
  wdaScreen: boolean
  getDevice: () => Device
  isShown: () => boolean
  canControl: () => boolean
  onDisplayError: (error: DisplayError) => void
  onFirstFrame: () => void
  onInputReady: (sessionId: string | null) => void
  onWdaInputReady: (ready: boolean) => void
  onStatusChange: (status: ScreenStreamStatus) => void
  onAndroidDisplay?: (state: AndroidDisplayState | null) => void
  onAndroidInputReady?: (revision: string | null) => void
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

const MAX_HEVC_RETRIES = 3

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

function isDisplayTarget(target: AndroidDisplayTarget | null | undefined): target is AndroidDisplayTarget {
  return !!target && target.id === 0 &&
    Number.isSafeInteger(target.width) && target.width > 0 &&
    Number.isSafeInteger(target.height) && target.height > 0 &&
    [0, 90, 180, 270].includes(target.rotation) &&
    typeof target.revision === 'string' && /^[a-z0-9-]{1,64}$/i.test(target.revision)
}

export function startScreenStream(options: ScreenStreamOptions): ScreenStream {
  const {root, positioner, canvas, screen, wdaScreen, getDevice} = options
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
  let hevcInput: 'waiting' | 'available' | 'requested' | 'ready' = 'waiting'
  let hevc: ReturnType<typeof startHevcScreen> | null = null
  let wdaInputReady = false
  let androidDisplay: AndroidDisplayTarget | null = null
  // Legacy Android providers send frames without a display revision.
  let appliedDisplay: string | null | undefined
  let androidInputReady: string | null = null

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
    if (wdaInputReady) {
      wdaInputReady = false
      options.onWdaInputReady(false)
    }
    if (androidInputReady !== null) {
      androidInputReady = null
      options.onAndroidInputReady?.(null)
    }
    frameGeneration += 1
    g.clearRect(0, 0, canvas.width, canvas.height)
    root.classList.remove('has-frame')
  }

  function adjustBoundedSize(w: number, h: number): BoundSize {
    const display = androidDisplay ?? getDevice().display
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
      (!isIPhone() || (wdaScreen ? canControlIPhone() : !isLockedIPhone() && !isAutomated(getDevice())))
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
    if (hevcInput === 'ready') {
      options.onInputReady(null)
    }
    hevcInput = 'waiting'
    hevcRequested = false
    hevc?.close()
    hevc = null
    delete screen.inputScaler
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
              queueMicrotask(checkIosEnabled)
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

  function closeIosConnection() {
    const waitForClose = hevcRequested
    if (ws) {
      if ((hevcRequested || wdaScreen) && isOpen()) {
        ws.send('off')
      }
      transportLost ||= hevc !== null || wdaInputReady
      clearFrame()
    }
    closeHevc()
    cancelRetry()
    closeSocket(waitForClose)
  }

  function iosBlock(): DisplayError | undefined {
    if (!shouldViewScreen()) {
      return false
    }
    if (isAutomated(getDevice())) {
      return 'hevc-automation'
    }
    if (wdaScreen) {
      return canControlIPhone() ? undefined : false
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

  function checkIosEnabled() {
    if (stopped) {
      return
    }
    const block = iosBlock()
    if (typeof block !== 'undefined') {
      observedAutomation = block === 'hevc-automation'
      awaitingLockStatus = false
      closeIosConnection()
      retryAttempt = 0
      setDisplayError(block)
      updateStatus()
      return
    }
    if (displayError === 'hevc-locked' || (observedAutomation && displayError === 'hevc-automation')) {
      setDisplayError(false)
    }
    observedAutomation = false
    if (!ws && awaitingLockStatus && getDevice().ios?.locked === false) {
      awaitingLockStatus = false
      retryAttempt = 0
      cancelRetry()
      if (displayError === 'hevc-unavailable') {
        setDisplayError(false)
      }
    }
    if ((hevcInput === 'requested' || hevcInput === 'ready') && !canControlIPhone()) {
      closeIosConnection()
    }
    updateStatus()
    if (!displayError && updateBounds() && !ws && !finishHevcClose && !retryTimer) {
      connect()
    }
    requestHevcInput()
  }

  function checkEnabled() {
    if (isIPhone()) {
      checkIosEnabled()
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

  function updateAndroidDisplay(state: AndroidDisplayState) {
    const target = state?.selected
    if (typeof target?.id === 'number' && target.id !== 0) {
      // An earlier preview may still stream a secondary display. Never mark its frames
      // ready for input on the primary display.
      androidDisplay = null
      appliedDisplay = null
      transportLost = true
      clearFrame()
      options.onAndroidDisplay?.(null)
      updateStatus()
      return
    }
    if (!isDisplayTarget(target) || typeof state.singleTouch !== 'boolean') {
      return
    }
    if (androidDisplay?.revision !== target.revision) {
      appliedDisplay = null
      clearFrame()
      androidDisplay = target
      screen.rotation = target.rotation
      screen.inputScaler = scalingCoordinator(target.width, target.height)
      updateBounds()
    }
    options.onAndroidDisplay?.({
      selected: target
    , singleTouch: state.singleTouch
    , ...(isFold4PostureMode(state.posture) ? {posture: state.posture} : {})
    })
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
          if (androidDisplay && androidInputReady !== androidDisplay.revision) {
            androidInputReady = androidDisplay.revision
            options.onAndroidInputReady?.(androidInputReady)
          }
          if (wdaScreen && !wdaInputReady) {
            retryAttempt = 0
            wdaInputReady = true
            options.onWdaInputReady(true)
          }
        }
        finally {
          bitmap.close()
        }
      })
      .catch(() => undefined)
  }

  function failIosStream(error: Exclude<DisplayError, false | 'secure'>) {
    closeIosConnection()
    if (error === 'hevc-unavailable') {
      transportLost = true
      scheduleRetry()
      checkIosEnabled()
    }
    else {
      setDisplayError(error)
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
        const {displayWidth: width, displayHeight: height} = frame
        if (width <= 0 || width >= height) {
          failIosStream('hevc-unavailable')
          return
        }
        // The registration screenshot can predate a rotation. Draw and scale
        // input from the same complete, currently decoded portrait frame.
        if (!screen.inputScaler || cachedImageWidth !== width || cachedImageHeight !== height) {
          screen.inputScaler = scalingCoordinator(width, height)
        }
        drawImage(frame, width, height, 1)
        retryAttempt = 0
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
          failIosStream(reason === 'unsupported' ? 'hevc-unsupported' : 'hevc-unavailable')
        }
      }
    })
    hevc = session
  }

  function connect() {
    const socket = new WebSocket(options.url)
    const iphone = isIPhone()
    const native = iphone && !wdaScreen
    socket.binaryType = native ? 'arraybuffer' : 'blob'
    ws = socket
    socket.onmessage = (message: MessageEvent) => {
      if (ws !== socket || stopped) {
        return
      }
      const display = getDevice().display
      screen.rotation = native ? 0 : (androidDisplay?.rotation ?? display?.rotation ?? 0)

      if (message.data instanceof ArrayBuffer) {
        if (hevc && shouldUpdateScreen()) {
          hevc.receive(message.data)
        }
      }
      else if (message.data instanceof Blob) {
        if (!native && shouldUpdateScreen() &&
          (typeof appliedDisplay === 'undefined' || appliedDisplay === androidDisplay?.revision)) {
          drawFrame(message.data, socket)
        }
      }
      else if (typeof message.data === 'string' && message.data.startsWith('hevc input ready ')) {
        const sessionId = message.data.slice('hevc input ready '.length)
        if (hevcInput === 'requested' && sessionId.length > 0 && sessionId.length <= 128 &&
          !/[^A-Za-z0-9-]/.test(sessionId) &&
          canControlIPhone() && shouldUpdateScreen()) {
          hevcInput = 'ready'
          options.onInputReady(sessionId)
        }
      }
      else if (message.data === 'hevc automation') {
        if (hevcRequested || wdaScreen) {
          failIosStream('hevc-automation')
        }
      }
      else if (message.data === 'hevc unsupported' || message.data === 'hevc unavailable') {
        if (hevcRequested && shouldUpdateScreen()) {
          const error = message.data === 'hevc unsupported' ? 'coredevice-unsupported' : 'hevc-unavailable'
          failIosStream(error)
        }
      }
      else if (typeof message.data === 'string' && message.data.startsWith('hevc ')) {
        openHevc(message.data.slice('hevc '.length), socket)
      }
      else if (typeof message.data === 'string' && message.data.startsWith('displays ') && !iphone) {
        try {
          updateAndroidDisplay(JSON.parse(message.data.slice('displays '.length)))
        }
        catch {
          // Ignore malformed stream metadata.
        }
      }
      else if (typeof message.data === 'string' && message.data.startsWith('start ')) {
        try {
          const banner = JSON.parse(message.data.slice('start '.length))
          if (typeof banner?.quirks?.alwaysUpright !== 'boolean') {
            return
          }
          if (androidDisplay) {
            if (!isDisplayTarget(banner.display) || banner.display.revision !== androidDisplay.revision) {
              appliedDisplay = null
              clearFrame()
              return
            }
            appliedDisplay = androidDisplay.revision
          }
          applyQuirks(banner)
        }
        catch {
          // Ignore malformed stream metadata.
        }
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
      if (iphone) {
        checkIosEnabled()
        if (ws === socket) {
          if (native) {
            // Native status, frames and input acknowledgement belong to this socket only.
            awaitingLockStatus = getDevice().ios?.locked !== false
            hevcRequested = true
            socket.send('hevc')
          }
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
      if (androidDisplay) {
        androidDisplay = null
        appliedDisplay = null
        options.onAndroidDisplay?.(null)
      }
      updateStatus()
      if (iphone) {
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
    if (!stopped && !ws && !retryTimer && !displayError && typeof iosBlock() === 'undefined') {
      if (!wdaScreen && retryAttempt >= MAX_HEVC_RETRIES) {
        setDisplayError('hevc-unavailable')
        return
      }
      retryTimer = setTimeout(() => {
        retryTimer = null
        checkIosEnabled()
      }, Math.min(5000, 500 * 2 ** Math.min(4, retryAttempt++)))
    }
  }

  function resize() {
    parentAspect = root.offsetWidth / root.offsetHeight
    maybeFlipLetterbox()
  }

  function retry() {
    if (displayError === 'hevc-unavailable' && typeof iosBlock() === 'undefined') {
      retryAttempt = 0
      transportLost = true
      setDisplayError(false)
      checkIosEnabled()
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
    checkIosEnabled()
  }
  else {
    connect()
  }
  resize()

  return {checkEnabled, resize, retry, stop}
}
