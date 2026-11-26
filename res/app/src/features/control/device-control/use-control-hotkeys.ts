import {useHotkeys} from '@mantine/hooks'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {usePlatform} from '@/ui/modes'
import type {DeviceActions} from './use-device-actions'

// Mantine skips hotkeys whose target has one of these tags (and contentEditable elements). The meta+… shortcuts
// don't type text, so they also work in inputs and textareas, including the screen keyboard input.
const ignoredTags = ['SELECT']
const textInputTypes = ['text', 'search', 'url', 'email', 'password', 'number', 'tel']

// Only fields that take typed text count: checkboxes, switches, radios and read-only inputs (Mantine's Select)
// keep focus after a click, but typing there doesn't produce text, so the typing shortcuts must still work.
function takesText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly
  }
  return target instanceof HTMLInputElement && textInputTypes.includes(target.type) && !target.readOnly
}

// shift+space selects the next IME on the device, so it must work in the screen keyboard input but not in other
// text fields, where it types a space.
function typesSpace(target: EventTarget | null) {
  return takesText(target) && !(target as HTMLElement).classList.contains('stf-screen-keyboard')
}

export function useControlHotkeys(control: Control, actions: DeviceActions, ios = false, readOnly = false) {
  const navigate = useNavigate()
  const [platform, setPlatform] = usePlatform()
  const androidOnly: Parameters<typeof useHotkeys>[0] = ios || readOnly ? [] : [
    ['shift+space', (event) => {
      if (!typesSpace(event.target)) {
        event.preventDefault()
        control.keyPress('switch_charset')
      }
    }, {preventDefault: false}]
    , ['meta+ArrowLeft', () => actions.rotateBy(-90)]
    , ['meta+ArrowRight', () => actions.rotateBy(90)]
    , ['meta+shift+M', () => control.menu()]
    , ['meta+shift+B', () => control.back()]
  ]

  const common: Parameters<typeof useHotkeys>[0] = readOnly ? [] : [
    ['meta+shift+H', () => control.home()]
  ]

  useHotkeys([
    ['meta+shift+D', () => navigate('/devices')]
    // a capital W typed into a text field (the Shell input, the screen keyboard) must stay a W
    , ['shift+W', (event) => {
      if (!takesText(event.target)) {
        event.preventDefault()
        setPlatform(platform === 'web' ? 'native' : 'web')
      }
    }, {preventDefault: false}]
    , ...common
    , ...androidOnly
  ], ignoredTags)
}
