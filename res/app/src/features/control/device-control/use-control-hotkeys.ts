import {useHotkeys} from '@mantine/hooks'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {usePlatform} from '@/ui/modes'
import type {DeviceActions} from './use-device-actions'

// The meta+… shortcuts don't type text, so they also work while typing, including into the device through
// the screen keyboard input. Shortcuts that do type text stay out of the text fields.
const allowInInputs = ['SELECT']
const textFields = ['INPUT', 'TEXTAREA', 'SELECT']

// shift+space selects the next IME on the device, so it must work in the screen keyboard input but nowhere else
// where it types a space.
function typesText(target: EventTarget | null) {
  return target instanceof HTMLElement && !target.classList.contains('stf-screen-keyboard') &&
    (target.isContentEditable || textFields.includes(target.tagName))
}

export function useControlHotkeys(control: Control, actions: DeviceActions, ios = false, readOnly = false) {
  const navigate = useNavigate()
  const [platform, setPlatform] = usePlatform()
  const androidOnly: Parameters<typeof useHotkeys>[0] = ios || readOnly ? [] : [
    ['shift+space', (event) => {
      if (!typesText(event.target)) {
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
    , ...common
    , ...androidOnly
  ], allowInInputs)

  useHotkeys([
    ['shift+W', () => setPlatform(platform === 'web' ? 'native' : 'web'), {preventDefault: false}]
  ], textFields)
}
