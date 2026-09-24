import {describe, expect, it} from 'vitest'
import {computeState, enhanceDevice, userProfileUrl} from './enhance'
import type {Device} from './types'

function device(overrides: Partial<Device>): Device {
  return {
    serial: 'serial'
    , present: true
    , ready: true
    , status: 3
    , channel: 'channel'
    , group: {id: 'g', name: 'g', owner: {email: 'owner@example.com'}}
    , ...overrides
  } as Device
}

describe('enhanceDevice', () => {
  it('computes the aggregate state', () => {
    expect(computeState(device({present: false}))).toBe('absent')
    expect(computeState(device({status: 1}))).toBe('offline')
    expect(computeState(device({status: 2}))).toBe('unauthorized')
    expect(computeState(device({ready: false}))).toBe('preparing')
    expect(computeState(device({}))).toBe('available')
    expect(computeState(device({owner: {email: 'x'}}))).toBe('busy')
    expect(computeState(device({owner: {email: 'x'}, using: true}))).toBe('using')
    expect(computeState(device({owner: {email: 'x'}, using: true, usage: 'automation'}))).toBe('automation')
  })

  it('derives usability and display fields', () => {
    const busy = enhanceDevice(device({owner: {email: 'other@example.com'}, using: true, model: 'Pixel'}))
    expect(busy.usable).toBe(true)
    expect(busy.state).toBe('using')

    const stolen = enhanceDevice(device({owner: {email: 'other@example.com'}, using: false}))
    expect(stolen.usable).toBe(false)
    expect(stolen.state).toBe('busy')

    const named = enhanceDevice(device({marketName: 'Galaxy', model: 'SM-1', image: 'x.jpg'}))
    expect(named.enhancedName).toBe('Galaxy')
    expect(named.enhancedImage120).toBe('/static/app/devices/icon/x120/x.jpg')
    expect(named.enhancedStateAction).toBe('Use')
    expect(named.enhancedGroupOwnerProfileUrl).toBe('mailto:owner@example.com')
  })

  it('builds battery details', () => {
    const charged = enhanceDevice(device({battery: {
      health: 'good', level: 50, scale: 100, source: 'usb', status: 'charging', temp: 30, voltage: 4
    }}))
    expect(charged.enhancedBatteryPercentage).toBe('50%')
    expect(charged.enhancedBatteryHealth).toBe('Good')
    expect(charged.enhancedBatteryTemp).toBe('30°C')
  })

  it('links non email owners to the user page', () => {
    expect(userProfileUrl('someone')).toBe('/#/user/someone')
  })
})
