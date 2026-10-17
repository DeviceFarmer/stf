import assert from 'node:assert/strict'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import express from 'express'
import datautil from '../../lib/util/datautil.js'
import {deviceCatalog} from '../../lib/util/device-catalog.js'
import deviceIcons from '../../lib/units/app/middleware/device-icons.js'
import {fallbackDeviceImage} from '../../lib/util/device-image-paths.js'

function enrich(device: datautil.Device) {
  return datautil.applyData(device)
}

describe('device catalogue images', function() {
  it('recognizes the inventory without replacing hardware identifiers or measurements', function() {
    const inventory = [
      ['iOS', 'Apple', 'iPhone17,4', 'iPhone 16 Plus', 'iphone-16-plus-v2.webp']
    , ['iOS', 'Apple', 'iPhone14,2', 'iPhone 13 Pro', 'iphone-13-pro-v2.webp']
    , ['iOS', 'Apple', 'iPhone14,8', 'iPhone 14 Plus', 'iphone-14-plus-v2.webp']
    , ['Android', 'samsung', 'SM-A556E', 'Galaxy A55 5G', 'galaxy-a55-v2.webp']
    , ['Android', 'samsung', 'SM-F936B', 'Galaxy Z Fold4', 'galaxy-z-fold4-v2.webp']
    , ['Android', 'Xiaomi', 'Mi A2', 'Mi A2', 'mi-a2-v2.webp']
    , ['Android', 'Xiaomi', '23124RA7EO', 'Redmi Note 13', 'redmi-note-13-v2.webp']
    , ['Android', 'HUAWEI', 'CTR-L81', 'Huawei nova 12i', 'huawei-nova-12i-v2.webp']
    ]
    for (const [platform, manufacturer, model, name, image] of inventory) {
      const device = {platform: platform!, manufacturer: manufacturer!, model: model!
        , product: 'reported-product', cpu: {cores: 7, freq: 2190, name: 'Measured CPU'}
        , display: {width: 1080, height: 2400}}
      datautil.applyData(device)
      assert.equal((device as datautil.Device).name, name)
      assert.equal((device as datautil.Device).image, image)
      assert.equal(device.model, model)
      assert.equal(device.product, 'reported-product')
      assert.deepEqual(device.cpu, {cores: 7, freq: 2190, name: 'Measured CPU'})
      assert.deepEqual(device.display, {width: 1080, height: 2400})
    }
  })

  it('matches product aliases and rejects a conflicting manufacturer or platform', function() {
    const huawei = {platform: 'Android', manufacturer: 'HUAWEI', product: 'HWCTRN-Q'}
    const redmi = {platform: 'Android', manufacturer: 'Xiaomi', product: 'sapphiren'}
    assert.equal(enrich(huawei).image, 'huawei-nova-12i-v2.webp')
    assert.equal(enrich(redmi).image, 'redmi-note-13-v2.webp')
    for (const device of [
      {platform: 'iOS', manufacturer: 'samsung', model: 'SM-A556E'}
    , {platform: 'Android', manufacturer: 'Other', model: 'SM-A556E'}
    , {platform: 'Android', manufacturer: 'Samsung', model: 'SM-A556E-unlisted'}
    ]) {
      assert.equal(enrich(device).image, fallbackDeviceImage)
    }
  })

  it('preserves legacy entries and falls back for unknown devices', function() {
    const legacy = enrich({model: 'Nexus 5', product: 'hammerhead'})
    assert.equal(legacy.image, 'Nexus_5.jpg')
    assert.equal(enrich({model: 'unlisted-phone'}).image, fallbackDeviceImage)
    assert.equal(enrich({model: 'unlisted-phone', image: 'custom.webp'}).image,
      'custom.webp')
  })
})

describe('device image HTTP resources', function() {
  let server: http.Server, origin: string
  before(async function() {
    server = http.createServer(express().use('/devices', deviceIcons()))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/devices/'
  })

  after(async function() {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  })

  it('serves each model at every size with caching and actual WebP bytes', async function() {
    for (const device of deviceCatalog) {
      assert.match(device.image, /^[a-z0-9-]+-v\d+\.webp$/)
      for (const size of ['icon/x24', 'icon/x120', 'photo/x800']) {
        const response = await fetch(origin + size + '/' + device.image)
        assert.equal(response.status, 200, size + '/' + device.image)
        assert.match(response.headers.get('content-type') || '', /^image\/webp/)
        assert.match(response.headers.get('cache-control') || '', /max-age=2592000/)
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
        assert.equal(bytes.toString('ascii', 12, 16), 'VP8X')
        assert.ok(bytes[20]! & 0x10, 'The distributed WebP must preserve alpha')
        const width = bytes.readUIntLE(24, 3) + 1
        const height = bytes.readUIntLE(27, 3) + 1
        assert.ok(width >= height * 0.9, 'Paired views need room for both phone faces')
        assert.equal(height, {'icon/x24': 48, 'icon/x120': 240, 'photo/x800': 800}[size])
      }
    }
  })

  it('serves the generic, falls through to legacy images, and returns 404 for missing files',
    async function() {
      for (const size of ['icon/x24', 'icon/x120', 'photo/x800']) {
        const response = await fetch(origin + size + '/' + fallbackDeviceImage)
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type') || '', /^image\/svg\+xml/)
        assert.match(await response.text(), /viewBox="0 0 400 800"/)
      }
      assert.equal((await fetch(origin + 'icon/x120/Nexus_5.jpg')).status, 200)
      assert.equal((await fetch(origin + 'icon/x120/does-not-exist.webp')).status, 404)
    })
})
