import {useHotkeys} from '@mantine/hooks'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {usePlatform} from '@/ui/modes'
import type {DeviceActions} from './use-device-actions'

const allowInInputs = ['SELECT']

export function useControlHotkeys(control: Control, actions: DeviceActions, ios = false) {
  const navigate = useNavigate()
  const [platform, setPlatform] = usePlatform()

  useHotkeys([
    ['meta+shift+D', () => navigate('/devices')]
    , ['shift+space', () => !ios && control.keyPress('switch_charset')]
    , ['meta+ArrowLeft', () => !ios && actions.rotateBy(-90)]
    , ['meta+ArrowRight', () => !ios && actions.rotateBy(90)]
    , ['meta+shift+M', () => !ios && control.menu()]
    , ['meta+shift+H', () => control.home()]
    , ['meta+shift+B', () => !ios && control.back()]
    , ['shift+W', () => setPlatform(platform === 'web' ? 'native' : 'web'), {preventDefault: false}]
  ], allowInInputs)
}
