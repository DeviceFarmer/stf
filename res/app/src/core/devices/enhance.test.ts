import {describe, expect, it} from 'vitest'
import {canViewDevice, computeState, enhanceDevice, setDeviceImage, userProfileUrl} from './enhance'
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
    expect(named.enhancedImage120).toBe('/static/app/devices/icon/x120/x.jpg?m=Galaxy')
    expect(named.enhancedImage24).toBe('/static/app/devices/icon/x24/x.jpg?m=Galaxy')
    expect(named.enhancedStateAction).toBe('Use')
    expect(named.enhancedGroupOwnerProfileUrl).toBe('mailto:owner@example.com')
  })

  it('shows automation for other owners without granting control or hiding the screen', () => {
    const automatic = enhanceDevice(device({owner: {email: 'ci@example.test'}, using: false, usage: 'automation'}))
    expect(automatic.state).toBe('automation')
    expect(automatic.usable).toBe(false)
    expect(automatic.enhancedStatePassive).toBe('Automated')
    expect(canViewDevice(automatic)).toBe(true)
    const released = enhanceDevice({...automatic, owner: null})
    expect(released.state).toBe('available')
    expect(canViewDevice(released)).toBe(false)
    expect(canViewDevice({...automatic, ready: false})).toBe(false)
  })

  it('passes live display, sdk, manufacturer, and marketName query parameters in setDeviceImage', () => {
    const live = device({
      image: 'Pixel_9.svg?dpi=3'
      , display: {width: 1080, height: 2424, rotation: 0, xdpi: 422, ydpi: 422}
      , sdk: '35'
      , manufacturer: 'Google'
      , marketName: 'Pixel 9'
    })
    setDeviceImage(live)
    expect(live.enhancedImage120).toBe(
      '/static/app/devices/icon/x120/Pixel_9.svg?dpi=3&w=1080&h=2424&xd=422&yd=422&sdk=35&b=Google&m=Pixel+9'
    )
    expect(live.enhancedImage24).toBe(
      '/static/app/devices/icon/x24/Pixel_9.svg?dpi=3&w=1080&h=2424&xd=422&yd=422&sdk=35&b=Google&m=Pixel+9'
    )

    const bare = device({})
    setDeviceImage(bare)
    expect(bare.enhancedImage120).toBe('/static/app/devices/icon/x120/generic-phone-v1.svg')
    expect(bare.enhancedImage24).toBe('/static/app/devices/icon/x24/generic-phone-v1.svg')

    const ios = device({
      platform: 'iOS'
      , image: 'iOS.jpg'
      , sdk: '17.4'
      , manufacturer: 'Apple'
      , marketName: 'iPhone 15'
    })
    setDeviceImage(ios)
    expect(ios.enhancedImage120).toBe('/static/app/devices/icon/x120/iOS.jpg?b=Apple&m=iPhone+15')

    const unknownSdk = device({
      image: 'Pixel_8.svg'
      , sdk: 'unknown'
      , manufacturer: 'Google'
    })
    setDeviceImage(unknownSdk)
    expect(unknownSdk.enhancedImage120).toBe('/static/app/devices/icon/x120/Pixel_8.svg?b=Google')
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
