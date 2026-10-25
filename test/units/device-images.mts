import assert from 'node:assert/strict'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Socket} from 'node:net'
import {Duplex} from 'node:stream'
import express from 'express'
import sinon from 'sinon'
import deviceData from '@devicefarmer/stf-device-db'
import datautil from '../../lib/util/datautil.js'
import {deviceCatalog} from '../../lib/util/device-catalog.js'
import deviceIcons from '../../lib/units/app/middleware/device-icons.js'
import {deviceImageUrl, fallbackDeviceImage} from '../../lib/util/device-image-paths.js'

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
    assert.match(legacy.image || '', /^Nexus_5\.(jpg|svg)$/)
    assert.equal(enrich({model: 'unlisted-phone'}).image, fallbackDeviceImage)
    assert.equal(enrich({model: 'unlisted-phone', image: 'custom.webp'}).image,
      'custom.webp')

    const withSize: datautil.Device = {
      model: 'Pixel 8'
    , display: {width: 1080, height: 2400, size: 6.200000047683716}
    }
    datautil.applyData(withSize)
    assert.equal(withSize.display?.inches, 6.2)

    const withDpi: datautil.Device = {
      model: 'Pixel 8'
    , display: {width: 1080, height: 2400, xdpi: 428, ydpi: 428}
    }
    datautil.applyData(withDpi)
    assert.equal(withDpi.display?.inches, 6.15)
  })
})

function dispatchRequest(
  app: express.Express
, requestUrl: string
): Promise<{status: number, headers: http.OutgoingHttpHeaders, body: string}> {
  return new Promise(function(resolve, reject) {
    const socket = new Duplex({
      read() {
        this.push(null)
      }
    , write(_chunk, _encoding, callback) {
        callback()
      }
    }) as unknown as Socket

    const req = new http.IncomingMessage(socket)
    req.method = 'GET'
    req.url = requestUrl
    req.headers = {host: 'localhost'}
    req.push(null)

    const res = new http.ServerResponse(req)
    const chunks: Buffer[] = []
    const origWrite = res.write.bind(res)
    const origEnd = res.end.bind(res)

    res.write = function(chunk: unknown, ...rest: unknown[]) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      }
      return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest)
    } as typeof res.write

    res.end = function(chunk?: unknown, ...rest: unknown[]) {
      if (chunk && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      }
      const result = (origEnd as (...args: unknown[]) => http.ServerResponse)(chunk, ...rest)
      resolve({
        status: res.statusCode
      , headers: res.getHeaders()
      , body: Buffer.concat(chunks).toString('utf8')
      })
      return result
    } as typeof res.end

    try {
      app(req, res)
    }
    catch (err) {
      reject(err)
    }
  })
}

describe('dynamic offline device SVG route', function() {
  afterEach(function() {
    sinon.restore()
  })

  it('serves dynamic SVGs with Content-Type and Cache-Control across x24, x120, and x800',
    async function() {
      const app = express()
      app.use('/static/app/devices', deviceIcons())

      for (const route of [
        '/static/app/devices/icon/x24/Nexus_5.jpg'
      , '/static/app/devices/icon/x120/Nexus_5.svg'
      , '/static/app/devices/photo/x800/Nexus_5.svg'
      ]) {
        const res = await dispatchRequest(app, route)
        assert.equal(res.status, 200, route)
        assert.match(String(res.headers['content-type'] || ''), /^image\/svg\+xml/)
        assert.match(String(res.headers['cache-control'] || ''), /max-age=2592000/)
        assert.equal(
          res.headers['content-security-policy']
        , 'default-src \'none\'; style-src \'unsafe-inline\''
        )
        assert.equal(res.headers['x-content-type-options'], 'nosniff')
        assert.match(res.body, /^<svg[\s>]/)
        assert.match(res.body, /Nexus 5/)
      }

      const op12 = enrich({model: 'CPH2581'})
      assert.equal(op12.image, 'CPH2581.svg')
      const op12Photo = await dispatchRequest(app, '/static/app/devices/photo/x800/' + op12.image)
      assert.equal(op12Photo.status, 200)
      assert.match(op12Photo.body, /OnePlus 12/)
      assert.match(op12Photo.body, /Snapdragon 8 Gen3/)
      assert.match(op12Photo.body, /256 GB Storage/)
    })

  it('passes model lookup and optional query params (w, h, xd, yd, sdk, b, m) to generateDeviceSvg',
    async function() {
      const app = express()
      app.use('/static/app/devices', deviceIcons())

      const captured: deviceData.StfDeviceSvgParams[] = []
      const target = deviceData as {
        generateDeviceSvg?: (params: deviceData.StfDeviceSvgParams) => string
      }
      const previous = target.generateDeviceSvg
      target.generateDeviceSvg = function(params: deviceData.StfDeviceSvgParams) {
        captured.push(params)
        return '<svg xmlns="http://www.w3.org/2000/svg" data-stub="1"></svg>'
      }

      try {
        const url = deviceImageUrl('Pixel_9_Pro.svg', 'icon/x120', {
          display: {width: 1280, height: 2856, xdpi: 495, ydpi: 495}
        , sdk: '35'
        , manufacturer: 'Google'
        , marketName: 'Pixel 9 Pro'
        })
        const res = await dispatchRequest(app, url)
        assert.equal(res.status, 200)
        assert.match(String(res.headers['content-type'] || ''), /^image\/svg\+xml/)
        assert.match(String(res.headers['cache-control'] || ''), /max-age=2592000/)
        assert.equal(res.body, '<svg xmlns="http://www.w3.org/2000/svg" data-stub="1"></svg>')
        assert.equal(captured.length, 1)
        assert.equal(captured[0]!.size, 'x120')
        assert.equal(captured[0]!.width, 1280)
        assert.equal(captured[0]!.height, 2856)
        assert.equal(captured[0]!.xdpi, 495)
        assert.equal(captured[0]!.ydpi, 495)
        assert.equal(captured[0]!.sdk, 35)
        assert.equal(captured[0]!.brand, 'Google')
        assert.equal(captured[0]!.marketName, 'Pixel 9 Pro')
      }
      finally {
        if (typeof previous === 'function') {
          target.generateDeviceSvg = previous
        }
        else {
          delete target.generateDeviceSvg
        }
      }
    })

  it('handles iOS.jpg and iOS cleanly without 404 and rejects unsupported route segments',
    async function() {
      const app = express()
      app.use('/static/app/devices', deviceIcons())

      for (const iosPath of [
        '/static/app/devices/icon/x120/iOS.jpg'
      , '/static/app/devices/icon/x24/iOS'
      , '/static/app/devices/photo/x800/iOS.jpg?w=1179&h=2556&xd=460&yd=460&b=Apple&m=iPhone+15'
      ]) {
        const res = await dispatchRequest(app, iosPath)
        assert.equal(res.status, 200, iosPath)
        assert.match(String(res.headers['content-type'] || ''), /^image\/svg\+xml/)
        assert.match(res.body, /Apple/)
      }

      const parameterizedGeneric = await dispatchRequest(
        app
      , '/static/app/devices/icon/x120/generic-phone-v1.svg' +
        '?w=1080&h=2400&xd=420&yd=420&sdk=35&b=QUALCOMM&m=QRD'
      )
      assert.equal(parameterizedGeneric.status, 200)
      assert.match(parameterizedGeneric.body, /QUALCOMM/)
      assert.match(parameterizedGeneric.body, /QRD/)

      assert.equal(
        (await dispatchRequest(app, '/static/app/devices/other/x120/Nexus_5.svg')).status
      , 404
      )
      assert.equal(
        (await dispatchRequest(app, '/static/app/devices/icon/x999/Nexus_5.svg')).status
      , 404
      )
      assert.equal(
        (await dispatchRequest(app, '/static/app/devices/icon/x120/does-not-exist.webp')).status
      , 404
      )
      assert.equal(
        (await dispatchRequest(app, '/static/app/devices/icon/x120/does-not-exist.png')).status
      , 404
      )
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
