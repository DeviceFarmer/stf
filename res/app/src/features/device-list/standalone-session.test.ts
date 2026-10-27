import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from '@/core/devices/types'

vi.mock('@/core/user', () => ({currentUser: {email: 'viewer@example.test'}}))
import {reportStandaloneSession, standaloneSessionType} from './standalone-session'

const postMessage = vi.fn()
beforeEach(() => {
  postMessage.mockReset()
  Object.defineProperty(window, 'opener', {value: {postMessage}, configurable: true})
})
afterEach(() => Reflect.deleteProperty(window, 'opener'))
function device(owner = {email: 'viewer@example.test', reservationId: 'reservation'}) {
  return {serial: 'phone', channel: 'channel', owner} as Device
}

describe('standalone ownership handoff', () => {
  it('reports explicit own manual control to the same-origin opener', () => {
    reportStandaloneSession(device(), true)
    expect(postMessage).toHaveBeenCalledWith({type: standaloneSessionType, serial: 'phone'
      , manual: true, channel: 'channel', ownerEmail: 'viewer@example.test', reservationId: 'reservation'}
    , window.location.origin)
  })
  it.each([
    {manual: false, owner: {email: 'viewer@example.test', reservationId: 'reservation'}}
    , {manual: true, owner: {email: 'other@example.test', reservationId: 'reservation'}}
    , {manual: true, owner: {email: 'viewer@example.test', reservationId: ''}}
  ])('does not authorize popup cleanup for watch, another owner, or an old provider: %j', ({manual, owner}) => {
    reportStandaloneSession(device(owner), manual)
    expect(postMessage.mock.calls[0]![0].manual).toBe(false)
  })
  it('does nothing without an opener', () => {
    Object.defineProperty(window, 'opener', {value: null, configurable: true})
    reportStandaloneSession(device(), true)
    expect(postMessage).not.toHaveBeenCalled()
  })
})
