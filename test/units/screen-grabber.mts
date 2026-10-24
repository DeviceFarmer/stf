import {expect} from 'chai'

import {resolveGrabber} from '../../lib/units/device/resources/minicap.js'

describe('screen grabber resolution', function() {
  it('should use minicap-bin for auto when a native lib matches the SDK exactly', function() {
    expect(resolveGrabber('auto', true, true)).to.equal('minicap-bin')
  })

  it('should use minicap-apk for auto when no native lib exists', function() {
    expect(resolveGrabber('auto', false, false)).to.equal('minicap-apk')
  })

  it('should use minicap-apk for auto on a preview build matched only by its base SDK', function() {
    expect(resolveGrabber('auto', false, true)).to.equal('minicap-apk')
  })

  it('should keep an explicit minicap-bin while any native lib matches', function() {
    expect(resolveGrabber('minicap-bin', false, true)).to.equal('minicap-bin')
  })

  it('should downgrade an explicit minicap-bin without a native lib', function() {
    expect(resolveGrabber('minicap-bin', false, false)).to.equal('minicap-apk')
  })

  it('should keep an explicit minicap-apk even when a native lib exists', function() {
    expect(resolveGrabber('minicap-apk', true, true)).to.equal('minicap-apk')
  })
})
