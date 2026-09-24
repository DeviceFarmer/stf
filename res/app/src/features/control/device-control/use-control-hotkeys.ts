import {useHotkeys} from '@mantine/hooks'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {usePlatform} from '@/ui/modes'
import type {DeviceActions} from './use-device-actions'

const allowInInputs = ['SELECT']

export function useControlHotkeys(control: Control, actions: DeviceActions) {
  const navigate = useNavigate()
  const [platform, setPlatform] = usePlatform()

  useHotkeys([
    ['meta+shift+D', () => navigate('/devices')]
    , ['shift+space', () => control.keyPress('switch_charset')]
    , ['meta+ArrowLeft', () => actions.rotateBy(-90)]
    , ['meta+ArrowRight', () => actions.rotateBy(90)]
    , ['meta+shift+M', () => control.menu()]
    , ['meta+shift+H', () => control.home()]
    , ['meta+shift+B', () => control.back()]
    , ['shift+W', () => setPlatform(platform === 'web' ? 'native' : 'web'), {preventDefault: false}]
  ], allowInInputs)
}
