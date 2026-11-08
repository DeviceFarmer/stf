import {expect} from 'chai'
import wire from '../../lib/wire/index.js'
import datautil from '../../lib/util/datautil.js'
import {computeDisplaySize, cleanDisplay} from '../../lib/util/displayutil.js'
import {normalizeDisplayProperties} from '../../lib/units/device/plugins/util/display.js'
import {populateImageSlug} from '../../lib/units/device/plugins/util/data.js'
import type {DisplayProperties} from '../../lib/types/device-plugins.js'

describe('headless display handling (GH #232)', function() {
  describe('computeDisplaySize', function() {
    it('calculates physical diagonal for valid dimensions and positive DPI', function() {
      const size = computeDisplaySize(1080, 2400, 420, 420)
      expect(Number.isFinite(size)).to.be.true
      expect(size).to.be.closeTo(6.26, 0.05)
    })

    it('returns undefined for headless devices with non-zero dimensions and xdpi=0, ydpi=0', function() {
      // Odroid C4 / N2 without HDMI attached reports 1920x1080 with xdpi=0, ydpi=0
      expect(computeDisplaySize(1920, 1080, 0, 0)).to.equal(undefined)
    })

    it('returns undefined for headless devices with zero dimensions and zero DPI', function() {
      expect(computeDisplaySize(0, 0, 0, 0)).to.equal(undefined)
    })

    it('returns undefined if either xdpi or ydpi is zero or negative', function() {
      expect(computeDisplaySize(1920, 1080, 0, 420)).to.equal(undefined)
      expect(computeDisplaySize(1920, 1080, 420, 0)).to.equal(undefined)
      expect(computeDisplaySize(1920, 1080, -1, 420)).to.equal(undefined)
    })
  })

  describe('normalizeDisplayProperties', function() {
    it('normalizes missing or invalid size and non-finite properties', function() {
      const raw: DisplayProperties = {
        id: 0
      , width: 1920
      , height: 1080
      , rotation: 0
      , xdpi: 0
      , ydpi: 0
      , fps: NaN
      , density: -1
      , secure: false
      , size: Infinity
      , url: 'ws://localhost:7100'
      }
      const normalized = normalizeDisplayProperties(raw)
      expect(normalized).to.not.have.property('size')
      expect(normalized.xdpi).to.equal(0)
      expect(normalized.ydpi).to.equal(0)
      expect(normalized.fps).to.equal(0)
      expect(normalized.density).to.equal(0)
    })

    it('preserves valid size if already present and positive', function() {
      const raw: DisplayProperties = {
        id: 0
      , width: 1080
      , height: 2400
      , rotation: 0
      , xdpi: 420
      , ydpi: 420
      , fps: 60
      , density: 2.6
      , secure: false
      , size: 6.2
      , url: 'ws://localhost:7100'
      }
      const normalized = normalizeDisplayProperties(raw)
      expect(normalized.size).to.equal(6.2)
      expect(normalized.xdpi).to.equal(420)
      expect(normalized.ydpi).to.equal(420)
    })
  })

  describe('cleanDisplay (database sanitize)', function() {
    it('returns undefined if display is missing', function() {
      expect(cleanDisplay()).to.equal(undefined)
    })

    it('drops a non-finite size and sanitizes xdpi, ydpi, fps, density to 0', function() {
      const dirty = {
        id: 0
      , width: 1920
      , height: 1080
      , rotation: 0
      , xdpi: NaN
      , ydpi: Infinity
      , fps: NaN
      , density: Infinity
      , secure: false
      , url: 'ws://localhost:7100'
      , size: Infinity
      }
      const cleaned = cleanDisplay(dirty)
      expect(cleaned).to.deep.equal({
        id: 0
      , width: 1920
      , height: 1080
      , rotation: 0
      , xdpi: 0
      , ydpi: 0
      , fps: 0
      , density: 0
      , secure: false
      , url: 'ws://localhost:7100'
      })
    })

    it('preserves valid headless display properties with zero DPI', function() {
      const headless = {
        id: 0
      , width: 1920
      , height: 1080
      , rotation: 0
      , xdpi: 0
      , ydpi: 0
      , fps: 59.94
      , density: 1.5
      , secure: false
      , url: 'ws://localhost:7100'
      , size: 0
      }
      const cleaned = cleanDisplay(headless)
      expect(cleaned).to.deep.equal(headless)
    })
  })

  describe('wire round-trip with headless display', function() {
    it('serializes DeviceDisplayMessage without a size (optional field)', function() {
      const displayMsg = new wire.DeviceDisplayMessage(
        0, 1920, 1080, 0, 0, 0, 59.94, 1.5, false, 'ws://localhost:7100'
      )
      const decoded = wire.DeviceDisplayMessage.decode(displayMsg.encode())
      expect(decoded.xdpi).to.equal(0)
      expect(decoded.size == null).to.be.true
    })

    it('serializes and deserializes DeviceDisplayMessage with zero DPI and size 0', function() {
      const displayMsg = new wire.DeviceDisplayMessage(
        0
      , 1920
      , 1080
      , 0
      , 0
      , 0
      , 59.94
      , 1.5
      , false
      , 'ws://localhost:7100'
      , 0
      )
      const encoded = displayMsg.encode()
      const decoded = wire.DeviceDisplayMessage.decode(encoded)

      expect(decoded.id).to.equal(0)
      expect(decoded.width).to.equal(1920)
      expect(decoded.height).to.equal(1080)
      expect(decoded.rotation).to.equal(0)
      expect(decoded.xdpi).to.equal(0)
      expect(decoded.ydpi).to.equal(0)
      expect(decoded.fps).to.be.closeTo(59.94, 0.01)
      expect(decoded.density).to.be.closeTo(1.5, 0.01)
      expect(decoded.secure).to.be.false
      expect(decoded.url).to.equal('ws://localhost:7100')
      expect(decoded.size).to.equal(0)
    })
  })

  describe('datautil.applyData with headless display', function() {
    it('leaves inches undefined when size is unknown and xdpi=0, ydpi=0', function() {
      const device: datautil.Device = {
        model: 'Odroid C4'
      , display: {
          width: 1920
        , height: 1080
        , xdpi: 0
        , ydpi: 0
        , density: 1.5
        , fps: 59.94
        }
      }
      datautil.applyData(device)
      expect(device.display?.inches).to.equal(undefined)
      expect(device.display).to.not.have.property('size')
    })

    it('calculates inches normally for devices with valid size', function() {
      const device: datautil.Device = {
        model: 'Pixel 8'
      , display: {
          width: 1080
        , height: 2400
        , xdpi: 428
        , ydpi: 428
        , size: 6.2
        }
      }
      datautil.applyData(device)
      expect(device.display?.inches).to.equal(6.2)
    })
  })

  describe('populateImageSlug with headless display', function() {
    it('falls back to density-derived dpi when xdpi and ydpi are 0', function() {
      const slug = populateImageSlug(null, {
        display: {
          id: 0
        , width: 1920
        , height: 1080
        , xdpi: 0
        , ydpi: 0
        , fps: 59.94
        , density: 1.5
        , rotation: 0
        , secure: false
        , size: 0
        }
      , sdk: '30'
      })
      expect(slug).to.equal('generic-phone-v1.svg?w=1920&h=1080&dpi=240&sdk=30')
    })
  })
})
