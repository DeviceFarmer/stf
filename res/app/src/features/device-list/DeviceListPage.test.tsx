import {MantineProvider} from '@mantine/core'
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {afterEach, expect, it, vi} from 'vitest'
import type {Device} from '@/core/devices/types'
import {useSettingsStore} from '@/core/settings'
import DeviceListPage from './DeviceListPage'

vi.mock('@/core/devices/store', async() => {
  const {enhanceDevice} = await import('@/core/devices/enhance')
  const devices = [enhanceDevice({serial: 'phone', name: 'Pixel', present: true, status: 3, ready: true} as Device)]
  return {useDevices: () => ({devices, loading: false})}
})
vi.mock('@/core/socket', () => ({emit: vi.fn()}))

afterEach(() => {
  cleanup()
  useSettingsStore.setState({settings: {}})
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderPage(reducedMotion = false, env: 'default' | 'test' = 'test') {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)'
    , addEventListener: vi.fn()
    , removeEventListener: vi.fn()
  })))
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
  return render(<MantineProvider env={env}><MemoryRouter><DeviceListPage /></MemoryRouter></MantineProvider>)
}

it('reveals Customize in the same slot to the left of Search when switching views', () => {
  renderPage()
  const search = screen.getByPlaceholderText('Search')
  const customizeSlot = screen.getByText('Customize').closest('[inert]')!
  expect(customizeSlot.nextElementSibling?.contains(search)).toBe(true)
  fireEvent.change(search, {target: {value: 'Pixel'}})

  fireEvent.click(screen.getByRole('radio', {name: 'Details'}))
  expect(customizeSlot.hasAttribute('inert')).toBe(false)
  const customize = screen.getByRole('button', {name: 'Customize'})
  expect(customizeSlot.contains(customize)).toBe(true)
  expect(screen.getByPlaceholderText('Search')).toBe(search)
  expect((search as HTMLInputElement).value).toBe('Pixel')

  fireEvent.click(customize)
  fireEvent.keyDown(screen.getByRole('button', {name: 'Reset'}), {key: 'Escape'})
  expect(screen.queryByRole('button', {name: 'Reset'})).toBeNull()
  fireEvent.click(customize)
  fireEvent.mouseDown(search)
  expect(screen.queryByRole('button', {name: 'Reset'})).toBeNull()

  fireEvent.click(customize)
  expect(screen.getByRole('button', {name: 'Reset'})).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', {name: 'Devices'}))
  expect(customizeSlot.hasAttribute('inert')).toBe(true)
  expect(screen.queryByRole('button', {name: 'Reset'})).toBeNull()
  fireEvent.click(screen.getByRole('radio', {name: 'Details'}))
  expect(screen.queryByRole('button', {name: 'Reset'})).toBeNull()
  expect(screen.getByRole('button', {name: 'Customize'})).toBe(customize)
})

it('keeps the closing menu visible and inert until its exit transition finishes', async() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame']})
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
  renderPage(false, 'default')
  fireEvent.click(screen.getByRole('radio', {name: 'Details'}))
  const customize = screen.getByRole('button', {name: 'Customize'})
  vi.spyOn(customize, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 110, 28))
  fireEvent.click(customize)
  await act(async() => vi.advanceTimersByTimeAsync(300))
  const menu = screen.getByRole('dialog')

  fireEvent.click(screen.getByRole('radio', {name: 'Devices'}))
  expect(menu.hasAttribute('inert')).toBe(true)
  expect(menu.style.display).not.toBe('none')
  await act(async() => vi.advanceTimersByTimeAsync(50))
  expect(menu.style.opacity).toBe('0')
  expect(menu.style.transitionDuration).toBe('250ms')
  await act(async() => vi.advanceTimersByTimeAsync(150))
  expect(menu.style.display).not.toBe('none')
  await act(async() => vi.advanceTimersByTimeAsync(100))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each([false, true])('switches the device workspace with reduced motion set to %s', (reducedMotion) => {
  const {container} = renderPage(reducedMotion)
  const content = container.querySelector<HTMLDivElement>('.selectable')!
  const cancel = vi.fn()
  content.animate = vi.fn().mockReturnValue({cancel})

  fireEvent.change(screen.getByPlaceholderText('Search'), {target: {value: 'Pixel'}})
  expect(content.animate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('radio', {name: 'Details'}))
  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
  expect(content.animate).toHaveBeenCalledTimes(reducedMotion ? 0 : 1)

  fireEvent.click(screen.getByRole('radio', {name: 'Devices'}))
  expect(screen.getByRole('list')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
  expect(container.querySelector('.selectable')).toBe(content)
  expect(content.animate).toHaveBeenCalledTimes(reducedMotion ? 0 : 2)
  expect(cancel).toHaveBeenCalledTimes(reducedMotion ? 0 : 1)
  if (!reducedMotion) {
    expect(content.animate).toHaveBeenLastCalledWith(
      [{opacity: 0.55}, {opacity: 1}]
      , {duration: 250, easing: 'ease-out'}
    )
  }
})
