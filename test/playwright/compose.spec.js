const {test, expect} = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const h = require('./helpers')

test('[check:compose_api] Nginx routes an authenticated request to the API',
  async function({page}) {
    await h.login(page)
    const response = await page.request.get('/api/v1/user')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.user.email).toBe(h.USER_EMAIL)
  })

test('[check:compose_storage] APK upload, manifest and download cross the storage services',
  async function({request}) {
    const apk = fs.readFileSync(path.resolve(
      __dirname, '../../test-results/compose/STFService.apk'
    ))
    const upload = await request.post('/s/upload/apk', {
      multipart: {
        file: {name: 'STFService.apk', mimeType: 'application/vnd.android.package-archive', buffer: apk}
      }
    })
    expect(upload.status()).toBe(201)
    const body = await upload.json()
    expect(body.success).toBe(true)
    const href = body.resources.file.href
    const manifest = await request.get(href + '/manifest')
    expect(manifest.status()).toBe(200)
    const metadata = await manifest.json()
    expect(metadata.success).toBe(true)
    expect(metadata.manifest.package).toBe('jp.co.cyberagent.stf')
    const download = await request.get(href)
    expect(download.status()).toBe(200)
    expect(await download.body()).toEqual(apk)
  })

test('[check:compose_storage] the image service fetches and resizes an uploaded PNG',
  async function({request}) {
    const png = fs.readFileSync(path.resolve(
      __dirname, '../../res/common/logo/exports/STF-128.png'
    ))
    const upload = await request.post('/s/upload/image', {
      multipart: {
        file: {name: 'image.png', mimeType: 'image/png', buffer: png}
      }
    })
    expect(upload.status()).toBe(201)
    const body = await upload.json()
    expect(body.success).toBe(true)
    const href = body.resources.file.href
    const original = await request.get(href.replace('/s/image/', '/s/blob/'))
    expect(original.status()).toBe(200)
    expect(await original.body()).toEqual(png)
    const resized = await request.get(href + '?crop=16x16')
    expect(resized.status()).toBe(200)
    const bytes = await resized.body()
    expect(bytes.subarray(0, 8)).toEqual(png.subarray(0, 8))
    expect(bytes.readUInt32BE(16)).toBe(16)
    expect(bytes.readUInt32BE(20)).toBe(16)
  })
