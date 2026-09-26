import type {Control} from '@/core/control'
import type {ScalingCoordinator} from '@/core/scaling'
import type {ScreenGeometry} from './screen-stream'

export interface ScreenTouchOptions {
  root: HTMLElement
  input: HTMLInputElement
  fingers: HTMLElement[]
  screen: ScreenGeometry
  scaler: ScalingCoordinator
  control: Control
}

const SEQ_CYCLE = 100
const MOUSE_PRESSURE = 0.5
const SECONDARY_BUTTON = 3

export function bindScreenTouch(options: ScreenTouchOptions): () => void {
  const {root, input, fingers, screen, scaler, control} = options
  const slots: number[] = []
  const slotted: Record<string, number> = Object.create(null)
  let seq = -1
  let fakePinch = false
  let lastPossiblyBuggyMouseUpEvent: MouseEvent | null = null

  function nextSeq(): number {
    seq += 1
    if (seq >= SEQ_CYCLE) {
      seq = 0
    }
    return seq
  }

  function createSlots() {
    for (let i = 9; i >= 0; --i) {
      slots.push(i)
    }
  }

  function activateFinger(index: number, x: number, y: number, pressure: number) {
    const scale = 0.5 + pressure
    fingers[index]!.classList.add('active')
    fingers[index]!.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale},${scale})`
  }

  function deactivateFinger(index: number) {
    fingers[index]!.classList.remove('active')
  }

  function deactivateFingers() {
    for (const finger of fingers) {
      finger.classList.remove('active')
    }
  }

  function calculateBounds() {
    const rect = root.getBoundingClientRect()
    screen.bounds.w = root.offsetWidth
    screen.bounds.h = root.offsetHeight
    screen.bounds.x = rect.left + window.scrollX
    screen.bounds.y = rect.top + window.scrollY
  }

  function scale(x: number, y: number) {
    return scaler.coords(screen.bounds.w, screen.bounds.h, x, y, screen.rotation)
  }

  function mouseMoveListener(e: MouseEvent) {
    if (e.which === SECONDARY_BUTTON) {
      return
    }
    e.preventDefault()

    const addGhostFinger = !fakePinch && e.altKey
    const deleteGhostFinger = fakePinch && !e.altKey

    fakePinch = e.altKey

    const x = e.pageX - screen.bounds.x
    const y = e.pageY - screen.bounds.y
    const scaled = scale(x, y)

    control.touchMove(nextSeq(), 0, scaled.xP, scaled.yP, MOUSE_PRESSURE)

    if (addGhostFinger) {
      control.touchDown(nextSeq(), 1, 1 - scaled.xP, 1 - scaled.yP, MOUSE_PRESSURE)
    }
    else if (deleteGhostFinger) {
      control.touchUp(nextSeq(), 1)
    }
    else if (fakePinch) {
      control.touchMove(nextSeq(), 1, 1 - scaled.xP, 1 - scaled.yP, MOUSE_PRESSURE)
    }

    control.touchCommit(nextSeq())

    activateFinger(0, x, y, MOUSE_PRESSURE)

    if (deleteGhostFinger) {
      deactivateFinger(1)
    }
    else if (fakePinch) {
      activateFinger(1, -e.pageX + screen.bounds.x + screen.bounds.w
        , -e.pageY + screen.bounds.y + screen.bounds.h, MOUSE_PRESSURE)
    }
  }

  function stopMousing() {
    root.removeEventListener('mousemove', mouseMoveListener)
    document.removeEventListener('mouseup', mouseUpListener)
    document.removeEventListener('mouseleave', mouseUpListener)
    deactivateFingers()
    control.gestureStop(nextSeq())
  }

  function mouseUpListener(e: MouseEvent) {
    if (e.which === SECONDARY_BUTTON) {
      return
    }
    e.preventDefault()

    control.touchUp(nextSeq(), 0)

    if (fakePinch) {
      control.touchUp(nextSeq(), 1)
    }

    control.touchCommit(nextSeq())

    deactivateFinger(0)

    if (fakePinch) {
      deactivateFinger(1)
    }

    stopMousing()
  }

  function startMousing() {
    control.gestureStart(nextSeq())
    input.focus({preventScroll: true})
  }

  function mouseDownListener(e: MouseEvent) {
    if (e.which === SECONDARY_BUTTON) {
      return
    }
    e.preventDefault()

    fakePinch = e.altKey

    calculateBounds()
    startMousing()

    const x = e.pageX - screen.bounds.x
    const y = e.pageY - screen.bounds.y
    const scaled = scale(x, y)

    control.touchDown(nextSeq(), 0, scaled.xP, scaled.yP, MOUSE_PRESSURE)

    if (fakePinch) {
      control.touchDown(nextSeq(), 1, 1 - scaled.xP, 1 - scaled.yP, MOUSE_PRESSURE)
    }

    control.touchCommit(nextSeq())

    activateFinger(0, x, y, MOUSE_PRESSURE)

    if (fakePinch) {
      activateFinger(1, -e.pageX + screen.bounds.x + screen.bounds.w
        , -e.pageY + screen.bounds.y + screen.bounds.h, MOUSE_PRESSURE)
    }

    root.addEventListener('mousemove', mouseMoveListener)
    document.addEventListener('mouseup', mouseUpListener)
    document.addEventListener('mouseleave', mouseUpListener)

    if (lastPossiblyBuggyMouseUpEvent && lastPossiblyBuggyMouseUpEvent.timeStamp > e.timeStamp) {
      mouseUpListener(lastPossiblyBuggyMouseUpEvent)
    }
    else {
      lastPossiblyBuggyMouseUpEvent = null
    }
  }

  function mouseUpBugWorkaroundListener(e: MouseEvent) {
    lastPossiblyBuggyMouseUpEvent = e
  }

  function touchMoveListener(e: TouchEvent) {
    e.preventDefault()

    for (const touch of Array.from(e.changedTouches)) {
      const slot = slotted[touch.identifier]
      if (typeof slot !== 'undefined') {
        const x = touch.pageX - screen.bounds.x
        const y = touch.pageY - screen.bounds.y
        const pressure = touch.force || 0.5
        const scaled = scale(x, y)

        control.touchMove(nextSeq(), slot, scaled.xP, scaled.yP, pressure)
        activateFinger(slot, x, y, pressure)
      }
    }

    control.touchCommit(nextSeq())
  }

  function stopTouching() {
    root.removeEventListener('touchmove', touchMoveListener)
    document.removeEventListener('touchend', touchEndListener)
    document.removeEventListener('touchleave', touchEndListener)
    deactivateFingers()
    control.gestureStop(nextSeq())
  }

  function touchEndListener(event: Event) {
    const e = event as TouchEvent
    let foundAny = false

    for (const touch of Array.from(e.changedTouches)) {
      const slot = slotted[touch.identifier]
      if (typeof slot !== 'undefined') {
        delete slotted[touch.identifier]
        slots.push(slot)
        control.touchUp(nextSeq(), slot)
        deactivateFinger(slot)
        foundAny = true
      }
    }

    if (foundAny) {
      control.touchCommit(nextSeq())
      if (!e.touches.length) {
        stopTouching()
      }
    }
  }

  function startTouching() {
    control.gestureStart(nextSeq())
  }

  function touchStartListener(e: TouchEvent) {
    e.preventDefault()

    calculateBounds()

    if (e.touches.length === e.changedTouches.length) {
      startTouching()
    }

    const currentTouches: Record<string, number> = Object.create(null)
    for (const touch of Array.from(e.touches)) {
      currentTouches[touch.identifier] = 1
    }

    if (Object.keys(slotted).some((id) => !(id in currentTouches))) {
      Object.keys(slotted).forEach((id) => {
        slots.push(slotted[id]!)
        delete slotted[id]
      })
      slots.sort().reverse()
      control.touchReset(nextSeq())
      deactivateFingers()
    }

    if (!slots.length) {
      throw new Error('Ran out of multitouch slots')
    }

    for (const touch of Array.from(e.changedTouches)) {
      const slot = slots.pop() as number
      const x = touch.pageX - screen.bounds.x
      const y = touch.pageY - screen.bounds.y
      const pressure = touch.force || 0.5
      const scaled = scale(x, y)

      slotted[touch.identifier] = slot
      control.touchDown(nextSeq(), slot, scaled.xP, scaled.yP, pressure)
      activateFinger(slot, x, y, pressure)
    }

    root.addEventListener('touchmove', touchMoveListener, {passive: false})
    document.addEventListener('touchend', touchEndListener)
    document.addEventListener('touchleave', touchEndListener)

    control.touchCommit(nextSeq())
  }

  root.addEventListener('touchstart', touchStartListener, {passive: false})
  root.addEventListener('mousedown', mouseDownListener)
  root.addEventListener('mouseup', mouseUpBugWorkaroundListener)

  createSlots()

  return () => {
    root.removeEventListener('touchstart', touchStartListener)
    root.removeEventListener('mousedown', mouseDownListener)
    root.removeEventListener('mouseup', mouseUpBugWorkaroundListener)
    root.removeEventListener('mousemove', mouseMoveListener)
    root.removeEventListener('touchmove', touchMoveListener)
    document.removeEventListener('mouseup', mouseUpListener)
    document.removeEventListener('mouseleave', mouseUpListener)
    document.removeEventListener('touchend', touchEndListener)
    document.removeEventListener('touchleave', touchEndListener)
    deactivateFingers()
  }
}
