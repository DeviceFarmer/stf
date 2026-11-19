import {MantineProvider} from '@mantine/core'
import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {afterEach, expect, it, vi} from 'vitest'
import {useSettingsStore} from '@/core/settings'
import DeviceListPage from './DeviceListPage'

vi.mock('@/core/devices/store', () => ({useDevices: () => ({devices: [], loading: false})}))
vi.mock('@/core/socket', () => ({emit: vi.fn()}))

afterEach(() => {
  cleanup()
  useSettingsStore.setState({settings: {}})
  vi.unstubAllGlobals()
})

it('reveals Customize in the same slot to the left of Search when switching views', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
  }))
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
  render(<MantineProvider env='test'><MemoryRouter><DeviceListPage /></MemoryRouter></MantineProvider>)

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
  expect(screen.getByRole('button', {name: 'Reset'})).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', {name: 'Devices'}))
  expect(customizeSlot.hasAttribute('inert')).toBe(true)
  expect(screen.queryByRole('button', {name: 'Reset'})).toBeNull()
})
