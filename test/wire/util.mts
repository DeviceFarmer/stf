import * as chai from 'chai'
var expect = chai.expect

import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'

describe('wireutil', function() {
  describe('toDeviceStatus', function() {
    it('should map the adb states STF handles', function() {
      expect(wireutil.toDeviceStatus('device')).to.equal(wire.DeviceStatus.ONLINE)
      expect(wireutil.toDeviceStatus('emulator')).to.equal(wire.DeviceStatus.ONLINE)
      expect(wireutil.toDeviceStatus('unauthorized')).to.equal(wire.DeviceStatus.UNAUTHORIZED)
      expect(wireutil.toDeviceStatus('offline')).to.equal(wire.DeviceStatus.OFFLINE)
      expect(wireutil.toDeviceStatus('connecting')).to.equal(wire.DeviceStatus.CONNECTING)
      expect(wireutil.toDeviceStatus('authorizing')).to.equal(wire.DeviceStatus.AUTHORIZING)
    })

    it('should map every other adb state to UNSUPPORTED', function() {
      [
        'recovery'
      , 'sideload'
      , 'rescue'
      , 'bootloader'
      , 'host'
      , 'no permissions (user in plugdev group; are your udev rules wrong?)'
      , 'unknown'
      , ''
      , 'constructor'
      , 'toString'
      , '__proto__'
      ].forEach(function(type) {
        expect(wireutil.toDeviceStatus(type), type).to.equal(wire.DeviceStatus.UNSUPPORTED)
      })
    })

    it('should give a status that the device messages can encode', function() {
      var status = wireutil.toDeviceStatus('recovery')

      var introduction = wire.Envelope.decode(wireutil.envelope(
        new wire.DeviceIntroductionMessage(
          'serial'
        , status
        , new wire.ProviderMessage('channel', 'provider')
        , 1
        )
      ))
      expect(wire.DeviceIntroductionMessage.decode(introduction.message).status)
        .to.equal(wire.DeviceStatus.UNSUPPORTED)

      var change = wire.Envelope.decode(wireutil.envelope(
        new wire.DeviceStatusMessage('serial', status, 1)
      ))
      expect(wire.DeviceStatusMessage.decode(change.message).status)
        .to.equal(wire.DeviceStatus.UNSUPPORTED)
    })
  })
})
