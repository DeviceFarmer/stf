import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'

const actions = vi.hoisted(() => ({kick: vi.fn(), save: vi.fn()}))
vi.mock('@/core/group', () => ({kickDevice: actions.kick}))
vi.mock('@/core/settings', () => ({getSetting: vi.fn(), setSetting: actions.save}))
import {openStandalone} from './standalone'

beforeEach(() => {
  vi.useFakeTimers()
  actions.kick.mockReset().mockResolvedValue(undefined)
  actions.save.mockReset()
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('standalone window ownership', () => {
  it.each([true, false])('preserves watch intent and releases only manual windows (automated: %s)', (automated) => {
    const device = enhanceDevice({serial: 'phone', present: true, status: 3, ready: true
      , owner: automated ? {email: 'runner@example.test'} : null
      , usage: automated ? 'automation' : null} as Device)
    const popup = {document: {title: ''}, innerWidth: 400, innerHeight: 800
      , screenTop: 20, screenLeft: 20} as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)
    expect(openStandalone(device)).toBe(popup)
    expect(open.mock.calls[0]![0]).toBe(`#/c/phone?standalone${automated ? '&mode=watch' : ''}`)
    popup.onbeforeunload!(new Event('beforeunload') as BeforeUnloadEvent)
    expect(actions.kick).toHaveBeenCalledTimes(automated ? 0 : 1)
    expect(actions.save).toHaveBeenCalledOnce()
  })
})
