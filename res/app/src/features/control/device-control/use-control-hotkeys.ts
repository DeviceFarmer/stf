import {useHotkeys} from '@mantine/hooks'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {usePlatform} from '@/ui/modes'
import type {DeviceActions} from './use-device-actions'

const allowInInputs = ['SELECT']

export function useControlHotkeys(control: Control, actions: DeviceActions, ios = false) {
  const navigate = useNavigate()
  const [platform, setPlatform] = usePlatform()
  const androidOnly: Parameters<typeof useHotkeys>[0] = ios ? [] : [
    ['shift+space', () => control.keyPress('switch_charset')]
    , ['meta+ArrowLeft', () => actions.rotateBy(-90)]
    , ['meta+ArrowRight', () => actions.rotateBy(90)]
    , ['meta+shift+M', () => control.menu()]
    , ['meta+shift+B', () => control.back()]
  ]

  useHotkeys([
    ['meta+shift+D', () => navigate('/devices')]
    , ['meta+shift+H', () => control.home()]
    , ['shift+W', () => setPlatform(platform === 'web' ? 'native' : 'web'), {preventDefault: false}]
    , ...androidOnly
  ], allowInInputs)
}
