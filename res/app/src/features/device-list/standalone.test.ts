import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'

const actions = vi.hoisted(() => ({release: vi.fn(), load: vi.fn(), save: vi.fn()
  , user: {email: 'viewer@example.test'}}))
vi.mock('@/core/group', () => ({releaseDevice: actions.release}))
vi.mock('@/core/devices/store', () => ({loadDevice: actions.load}))
vi.mock('@/core/user', () => ({currentUser: actions.user}))
vi.mock('@/core/settings', () => ({getSetting: vi.fn(), setSetting: actions.save}))
import {openStandalone} from './standalone'
import {standaloneSessionType} from './standalone-session'

const popups: Window[] = []
function phone(overrides: Partial<Device> = {}) {
  return enhanceDevice({serial: 'phone', channel: 'channel', present: true, status: 3, ready: true
    , usage: 'automation', owner: {email: 'runner@example.test', reservationId: 'runner-reservation'}
    , ...overrides} as Device)
}
function manualPhone(overrides: Partial<Device> = {}) {
  return phone({usage: null, using: true
    , owner: {email: actions.user.email, reservationId: 'manual-reservation'}, ...overrides})
}
function open(device = phone()) {
  const popup = {document: {title: ''}, innerWidth: 400, innerHeight: 800
    , screenTop: 20, screenLeft: 20, closed: false} as Window
  popups.push(popup)
  vi.spyOn(window, 'open').mockReturnValue(popup)
  expect(openStandalone(device)).toBe(popup)
  return popup
}
function message(popup: Window, data: Record<string, unknown> = {}, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent('message', {
    source: popup, origin, data: {type: standaloneSessionType, serial: 'phone'
      , manual: true, channel: 'channel', ownerEmail: actions.user.email
      , reservationId: 'manual-reservation', ...data}
  }))
}
async function close(popup: Window) {
  Object.defineProperty(popup, 'closed', {value: true, configurable: true})
  await vi.advanceTimersByTimeAsync(250)
}

beforeEach(() => {
  vi.useFakeTimers()
  actions.release.mockReset().mockResolvedValue(undefined)
  actions.load.mockReset().mockResolvedValue(manualPhone())
  actions.save.mockReset()
})
afterEach(async() => {
  await Promise.all(popups.splice(0).map(close))
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('standalone window ownership', () => {
  it.each([true, false])('preserves watch intent and saves geometry without releasing on reload (automated: %s)', async(automated) => {
    const popup = open(automated ? phone() : manualPhone())
    expect(vi.mocked(window.open).mock.calls[0]![0]).toBe(`#/c/phone?standalone${automated ? '&mode=watch' : ''}`)
    message(popup)
    popup.onbeforeunload!(new Event('beforeunload') as BeforeUnloadEvent)
    await vi.advanceTimersByTimeAsync(500)
    expect(actions.release).not.toHaveBeenCalled()
    expect(actions.load).not.toHaveBeenCalled()
    expect(actions.save).toHaveBeenCalledOnce()
  })
  it('releases confirmed manual control after a watch popup actually closes', async() => {
    const popup = open()
    message(popup)
    await close(popup)
    expect(actions.load).toHaveBeenCalledWith('phone')
    expect(actions.release).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'channel', owner: {email: actions.user.email, reservationId: 'manual-reservation'}
    }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.release).toHaveBeenCalledOnce()
  })
  it('waits briefly for the acknowledged owner write when closed immediately after Use', async() => {
    const popup = open()
    message(popup)
    actions.load.mockResolvedValueOnce(phone({owner: null, usage: null}))
    await close(popup)
    expect(actions.release).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(actions.load).toHaveBeenCalledTimes(2)
    expect(actions.release).toHaveBeenCalledOnce()
  })
  it('bounds retries for an empty owner snapshot without releasing a future reservation', async() => {
    const popup = open()
    message(popup)
    actions.load.mockResolvedValue(phone({owner: null, usage: null}))
    await close(popup)
    await vi.advanceTimersByTimeAsync(2000)
    expect(actions.load).toHaveBeenCalledTimes(10)
    expect(actions.release).not.toHaveBeenCalled()
    actions.load.mockResolvedValue(manualPhone())
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.load).toHaveBeenCalledTimes(10)
  })
  it.each([
    {owner: {email: actions.user.email, reservationId: 'replacement'}}
    , {channel: 'new-channel'}
  ])('stops retrying once a different reservation or runtime appears: %j', async(change) => {
    const popup = open()
    message(popup)
    actions.load.mockResolvedValueOnce(phone({owner: null, usage: null}))
      .mockResolvedValueOnce(manualPhone(change))
    await close(popup)
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.load).toHaveBeenCalledTimes(2)
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('does not release a merely watched device that the same account acquired elsewhere', async() => {
    const popup = open()
    await close(popup)
    expect(actions.load).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })
  it.each([
    {owner: {email: 'next@example.test', reservationId: 'next-reservation'}}
    , {owner: {email: actions.user.email, reservationId: 'new-reservation'}}
    , {channel: 'new-channel'}
    , {usage: 'automation'}
    , {present: false}
  ])('does not release a changed reservation or runtime: %j', async(change) => {
    const popup = open()
    message(popup)
    actions.load.mockResolvedValueOnce(manualPhone(change))
    await close(popup)
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('revokes cleanup when the popup returns to watch mode', async() => {
    const popup = open()
    message(popup)
    message(popup, {manual: false})
    await close(popup)
    expect(actions.release).not.toHaveBeenCalled()
  })
  it.each(['foreign-origin', 'foreign-window', 'foreign-serial', 'foreign-owner', 'missing-reservation'])('ignores an untrusted %s message', async(kind) => {
    const popup = open()
    if (kind === 'foreign-origin') {
      message(popup, {}, 'https://elsewhere.example')
    }
    else if (kind === 'foreign-window') {
      message({} as Window)
    }
    else if (kind === 'foreign-serial') {
      message(popup, {serial: 'other'})
    }
    else if (kind === 'foreign-owner') {
      message(popup, {ownerEmail: 'someone@example.test'})
    }
    else {
      message(popup, {reservationId: undefined})
    }
    await close(popup)
    expect(actions.load).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('survives leaving the device list and handles a failed fresh lookup', async() => {
    const popup = open()
    message(popup)
    await vi.advanceTimersByTimeAsync(11000)
    expect(actions.load).not.toHaveBeenCalled()
    actions.load.mockRejectedValueOnce(new Error('No access'))
    await close(popup)
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('keeps only one cleanup observer when reopening the same named popup', async() => {
    const popup = open()
    message(popup)
    expect(openStandalone(phone())).toBe(popup)
    // Reopening deliberately starts a new watch session, not an inherited lease.
    await close(popup)
    expect(actions.release).not.toHaveBeenCalled()
  })
})
