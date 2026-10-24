import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {DeviceActions} from './use-device-actions'
import {useControlHotkeys} from './use-control-hotkeys'

vi.mock('react-router', () => ({useNavigate: () => vi.fn()}))
vi.mock('@/ui/modes', () => ({usePlatform: () => ['web', vi.fn()]}))
afterEach(cleanup)

describe('device control keyboard shortcuts', () => {
  it.each([[true, false], [false, false], [true, true], [false, true]])(
    'registers platform-appropriate shortcuts (iOS: %s, read-only: %s)', (ios, readOnly) => {
    const control = {keyPress: vi.fn(), home: vi.fn(), menu: vi.fn(), back: vi.fn()} as unknown as Control
    const actions = {rotateBy: vi.fn()} as unknown as DeviceActions
    function Fixture() {
      useControlHotkeys(control, actions, ios, readOnly)
      return null
    }
    render(<Fixture />)
    const keys = [
      {key: ' ', code: 'Space', shiftKey: true}
      , {key: 'ArrowLeft', metaKey: true}
      , {key: 'ArrowRight', metaKey: true}
      , {key: 'M', metaKey: true, shiftKey: true}
      , {key: 'B', metaKey: true, shiftKey: true}
    ]
    for (const key of keys) {
      const event = new KeyboardEvent('keydown', {...key, bubbles: true, cancelable: true})
      document.body.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(!ios && !readOnly)
    }
    expect(control.keyPress).toHaveBeenCalledTimes(ios || readOnly ? 0 : 1)
    expect(actions.rotateBy).toHaveBeenCalledTimes(ios || readOnly ? 0 : 2)
    expect(control.menu).toHaveBeenCalledTimes(ios || readOnly ? 0 : 1)
    expect(control.back).toHaveBeenCalledTimes(ios || readOnly ? 0 : 1)
    const home = new KeyboardEvent('keydown', {key: 'H', metaKey: true, shiftKey: true
      , bubbles: true, cancelable: true})
    document.body.dispatchEvent(home)
    expect(home.defaultPrevented).toBe(!readOnly)
    expect(control.home).toHaveBeenCalledTimes(readOnly ? 0 : 1)
  })
})
