import {expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import {scalingCoordinator} from '@/core/scaling'
import {bindScreenTouch} from './screen-touch'

function fixture(singleTouch = false) {
  const root = document.createElement('div')
  Object.defineProperties(root, {offsetWidth: {value: 400}, offsetHeight: {value: 700}})
  const control = {gestureStart: vi.fn(), gestureStop: vi.fn(), touchDown: vi.fn(), touchUp: vi.fn()
    , touchMove: vi.fn(), touchCommit: vi.fn(), touchReset: vi.fn()}
  const unbind = bindScreenTouch({
    root, input: document.createElement('input')
  , fingers: Array.from({length: 10}, () => document.createElement('span'))
  , screen: {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
  , scaler: scalingCoordinator(1170, 2532), control: control as unknown as Control, singleTouch
  })
  return {root, control, unbind}
}

function touchEvent(type: string, id: number, held: boolean) {
  const finger = {identifier: id, pageX: 100, pageY: 100} as Touch
  return new TouchEvent(type, {touches: held ? [finger] : [], changedTouches: [finger], cancelable: true})
}

it('cancels a held touch without sending a tap and permits the next gesture', () => {
  const {root, control, unbind} = fixture()
  try {
    root.dispatchEvent(touchEvent('touchstart', 1, true))
    document.dispatchEvent(touchEvent('touchcancel', 2, false))
    expect(control.touchReset).not.toHaveBeenCalled()
    document.dispatchEvent(touchEvent('touchcancel', 1, false))
    expect(control.touchReset).toHaveBeenCalledExactlyOnceWith(3)
    expect(control.gestureStop).toHaveBeenCalledExactlyOnceWith(4)
    expect(control.touchUp).not.toHaveBeenCalled()

    root.dispatchEvent(touchEvent('touchstart', 3, true))
    document.dispatchEvent(touchEvent('touchend', 3, false))
    expect(control.gestureStart.mock.calls).toEqual([[0], [5]])
    expect(control.touchUp).toHaveBeenCalledExactlyOnceWith(8, 0)
    expect(control.gestureStop.mock.calls).toEqual([[4], [10]])
  }
  finally {
    unbind()
  }
})

it.each([true, false])('starts Alt-click only if pinch is supported (singleTouch: %s)', (singleTouch) => {
  const {root, control, unbind} = fixture(singleTouch)
  try {
    root.dispatchEvent(new MouseEvent('mousedown', {altKey: true, clientX: 100, clientY: 100, cancelable: true}))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(control.touchDown.mock.calls.map(([, slot]) => slot)).toEqual(singleTouch ? [] : [0, 1])
    expect(control.touchUp.mock.calls.map(([, slot]) => slot)).toEqual(singleTouch ? [] : [0, 1])
  }
  finally {
    unbind()
  }
})

it('ignores simultaneous iPhone contacts and accepts the next single-finger gesture', () => {
  const {root, control, unbind} = fixture(true)
  try {
    const touches = [1, 2].map(identifier => ({identifier, pageX: 100, pageY: 100}) as Touch)
    root.dispatchEvent(new TouchEvent('touchstart', {touches, changedTouches: touches, cancelable: true}))
    document.dispatchEvent(new TouchEvent('touchend', {changedTouches: touches, cancelable: true}))
    expect(control.gestureStart).not.toHaveBeenCalled()
    expect(control.touchDown).not.toHaveBeenCalled()
    expect(control.touchUp).not.toHaveBeenCalled()

    root.dispatchEvent(touchEvent('touchstart', 3, true))
    document.dispatchEvent(touchEvent('touchend', 3, false))
    expect(control.touchDown).toHaveBeenCalledOnce()
    expect(control.touchUp).toHaveBeenCalledOnce()
  }
  finally {
    unbind()
  }
})

it('resets a held mouse gesture on window blur or unbind', () => {
  const {root, control, unbind} = fixture()
  try {
    root.dispatchEvent(new MouseEvent('mousedown', {clientX: 100, clientY: 100, cancelable: true}))
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(control.touchReset).toHaveBeenCalledExactlyOnceWith(3)
    expect(control.gestureStop).toHaveBeenCalledExactlyOnceWith(4)
    expect(control.touchUp).not.toHaveBeenCalled()

    root.dispatchEvent(new MouseEvent('mousedown', {clientX: 100, clientY: 100, cancelable: true}))
    unbind()
    expect(control.touchReset.mock.calls).toEqual([[3], [8]])
    expect(control.gestureStop.mock.calls).toEqual([[4], [9]])
  }
  finally {
    unbind()
  }
})
