import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {DeviceActions} from './use-device-actions'
import {useControlHotkeys} from './use-control-hotkeys'

vi.mock('react-router', () => ({useNavigate: () => vi.fn()}))
const setPlatform = vi.fn()
vi.mock('@/ui/modes', () => ({usePlatform: () => ['web', setPlatform]}))
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.clearAllMocks()
})

function renderHotkeys() {
  const control = {keyPress: vi.fn(), home: vi.fn(), menu: vi.fn(), back: vi.fn()} as unknown as Control
  const actions = {rotateBy: vi.fn()} as unknown as DeviceActions
  function Fixture() {
    useControlHotkeys(control, actions)
    return null
  }
  render(<Fixture />)
  return control
}

function press(target: HTMLElement, key: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {...key, bubbles: true, cancelable: true})
  target.dispatchEvent(event)
  return event
}

function field(html: string) {
  document.body.insertAdjacentHTML('beforeend', html)
  const element = document.body.lastElementChild as HTMLElement
  // jsdom doesn't implement isContentEditable
  Object.defineProperty(element, 'isContentEditable', {value: element.hasAttribute('contenteditable')})
  return element
}

const shiftW = {key: 'W', code: 'KeyW', shiftKey: true}
const shiftSpace = {key: ' ', code: 'Space', shiftKey: true}
const textFields = [
  ['a text input', '<input type="text">']
  , ['a textarea', '<textarea></textarea>']
  , ['a contentEditable element', '<div contenteditable="true"></div>']
]
// focusable after a click, but typing there produces no text
const otherInputs = [
  ['a checkbox', '<input type="checkbox">']
  , ['a radio button', '<input type="radio">']
  , ['a read-only text input (Mantine Select)', '<input type="text" readonly>']
  , ['a button', '<button></button>']
]

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

describe('typing shortcuts in text fields', () => {
  it('toggles Web/Native with shift+W on the page', () => {
    renderHotkeys()
    press(document.body, shiftW)
    expect(setPlatform).toHaveBeenCalledWith('native')
  })

  it.each([...textFields, ['the screen keyboard', '<input type="password" class="stf-screen-keyboard">']])(
    'leaves shift+W to %s', (_, html) => {
    renderHotkeys()
    const event = press(field(html), shiftW)
    expect(setPlatform).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it.each(otherInputs)('toggles Web/Native with shift+W in %s', (_, html) => {
    renderHotkeys()
    const event = press(field(html), shiftW)
    expect(setPlatform).toHaveBeenCalledWith('native')
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(otherInputs)('switches the device charset with shift+space in %s', (_, html) => {
    const control = renderHotkeys()
    const event = press(field(html), shiftSpace)
    expect(control.keyPress).toHaveBeenCalledWith('switch_charset')
    // otherwise the browser toggles the checkbox or opens the dropdown
    expect(event.defaultPrevented).toBe(true)
  })

  it('switches the device charset with shift+space in the screen keyboard', () => {
    const control = renderHotkeys()
    const event = press(field('<input type="password" class="stf-screen-keyboard">'), shiftSpace)
    expect(control.keyPress).toHaveBeenCalledWith('switch_charset')
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(textFields)('lets shift+space type a space in %s', (_, html) => {
    const control = renderHotkeys()
    const event = press(field(html), shiftSpace)
    expect(control.keyPress).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps the meta shortcuts working in text fields', () => {
    const control = renderHotkeys()
    const event = press(field('<input type="text">'), {key: 'H', metaKey: true, shiftKey: true})
    expect(control.home).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
