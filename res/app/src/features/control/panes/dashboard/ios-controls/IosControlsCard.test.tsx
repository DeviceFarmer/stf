import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {IosControlsCard} from './IosControlsCard'

vi.mock('@/core/i18n', () => ({gettext: (text: string) => text, useTranslation: () => ({t: (text: string) => text})}))

describe('iPhone controls', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const control = {lock: vi.fn(), unlock: vi.fn(), shake: vi.fn(), iosPower: vi.fn()}
  const device = (locked: boolean) => ({serial: 'test', ios: {locked}} as Device)
  const render = async(locked: boolean) => act(async() => root.render(
    <MantineProvider>
      <IosControlsCard control={control as unknown as Control} device={device(locked)} />
    </MantineProvider>
  ))
  const button = (text: string) => Array.from(host.querySelectorAll('button'))
    .find(el => el.textContent === text)!
  const click = async(text: string) => act(async() => button(text).click())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it('switches between lock and unlock, with manual passcode guidance on an unsuccessful unlock', async() => {
    control.unlock.mockResolvedValue({body: {locked: true}})
    await render(true)
    expect(button('Shake phone').disabled).toBe(true)
    await click('Unlock screen')
    expect(control.unlock).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('The screen is still locked. Swipe up and enter the passcode')
    control.unlock.mockResolvedValue({body: {locked: false}})
    await click('Unlock screen')
    expect(host.textContent).toContain('The iPhone is unlocked.')
    await render(false)
    expect(button('Unlock screen').disabled).toBe(false)
    control.lock.mockResolvedValue({body: {locked: true}})
    await click('Lock screen')
    expect(control.lock).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('The iPhone is locked.')
  })

  it('does not power off without confirmation, lets the user cancel, and reports command failures', async() => {
    await render(false)
    await click('Power off iPhone')
    expect(control.iosPower).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Turning it on again requires physical access.')
    await click('Cancel')
    expect(button('Confirm')).toBeUndefined()
    await click('Restart iPhone')
    control.iosPower.mockRejectedValueOnce(new Error('transport error'))
    await click('Confirm')
    expect(control.iosPower).toHaveBeenCalledWith('reboot')
    expect(host.textContent).toContain('did not confirm the power command')
    control.iosPower.mockResolvedValueOnce({body: {accepted: true}})
    await click('Confirm')
    expect(host.textContent).toContain('accepted the restart command')
    expect(button('Lock screen').disabled).toBe(true)
  })
})
