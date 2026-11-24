import {flushSync} from 'react-dom'
import {ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme} from '@mantine/core'
import {useReducedMotion} from '@mantine/hooks'
import {IconMoon, IconSun} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import './ColorSchemeToggle.css'

export function ColorSchemeToggle() {
  const {t} = useTranslation()
  const {setColorScheme} = useMantineColorScheme()
  const colorScheme = useComputedColorScheme('light')
  const reducedMotion = useReducedMotion(undefined, {getInitialValueInEffect: false})
  const label = colorScheme === 'dark' ? t('Light') : t('Dark')

  function toggle() {
    function update() {
      // A queued transition may run after another click has already changed the scheme.
      const current = document.documentElement.dataset.mantineColorScheme ?? colorScheme
      setColorScheme(current === 'dark' ? 'light' : 'dark')
    }

    if (reducedMotion || typeof document.startViewTransition !== 'function') {
      update()
      return
    }

    const updateSnapshot = () => flushSync(update)
    const transition = globalThis.CSS?.supports('selector(:active-view-transition-type(stf-color-scheme))') ?
      document.startViewTransition({update: updateSnapshot, types: ['stf-color-scheme']}) :
      document.startViewTransition(updateSnapshot)
    // Starting another transition can skip the previous animation.
    transition.ready.catch(() => undefined)
  }

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant='subtle'
        color='gray'
        size='lg'
        onClick={toggle}
        aria-label={label}
        className='stf-color-scheme'
      >
        {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  )
}
