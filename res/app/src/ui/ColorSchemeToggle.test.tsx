import {MantineProvider} from '@mantine/core'
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {ColorSchemeToggle} from './ColorSchemeToggle'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})}))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'startViewTransition')
  document.documentElement.removeAttribute('data-mantine-color-scheme')
  window.localStorage.removeItem('mantine-color-scheme-value')
  vi.unstubAllGlobals()
})

function renderToggle(reducedMotion = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)'
    , addEventListener: vi.fn()
    , removeEventListener: vi.fn()
  }))
  render(<MantineProvider defaultColorScheme='light'><ColorSchemeToggle /></MantineProvider>)
}

it('applies two quick theme changes in order even when the first animation is skipped', () => {
  const updates: Array<() => void> = []
  vi.stubGlobal('CSS', {supports: () => true})
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true
    , value: ({update}: {update: () => void}) => {
      updates.push(update)
      return {ready: Promise.reject(new DOMException('Skipped', 'AbortError'))}
    }
  })
  renderToggle()

  fireEvent.click(screen.getByRole('button', {name: 'Dark'}))
  fireEvent.click(screen.getByRole('button', {name: 'Dark'}))
  expect(updates).toHaveLength(2)
  act(updates[0]!)
  expect(document.documentElement.dataset.mantineColorScheme).toBe('dark')
  act(updates[1]!)
  expect(document.documentElement.dataset.mantineColorScheme).toBe('light')
  expect(window.localStorage.getItem('mantine-color-scheme-value')).toBe('light')
})

it('switches the scheme immediately with reduced motion', () => {
  const startViewTransition = vi.fn()
  Object.defineProperty(document, 'startViewTransition', {configurable: true, value: startViewTransition})
  renderToggle(true)

  fireEvent.click(screen.getByRole('button', {name: 'Dark'}))
  expect(startViewTransition).not.toHaveBeenCalled()
  expect(document.documentElement.dataset.mantineColorScheme).toBe('dark')
})
