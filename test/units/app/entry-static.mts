import fs from 'node:fs/promises'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'
import compression from 'compression'
import express from 'express'

import entryStatic from '../../../lib/units/app/middleware/entry-static.js'

// What `npm pack` gives every file of the Docker image
const PACKED = new Date('1985-10-26T08:15:00Z')

// fetch() adds "Cache-Control: no-cache" to conditional requests, which always defeats a 304
function get(url: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{status: number, headers: http.IncomingHttpHeaders, body: string}>(
    (resolve, reject) => {
      http.get(url, {headers}, response => {
        var body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          body += chunk
        })
        response.on('end', () =>
          resolve({status: response.statusCode!, headers: response.headers, body}))
      }).on('error', reject)
    })
}

describe('prebuilt entry bundle', function() {
  var directories: string[] = []
  var servers: http.Server[] = []

  async function deploy(source: string) {
    var directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-entry-'))
    directories.push(directory)
    var file = path.join(directory, 'app.entry.js')
    await fs.writeFile(file, source)
    await fs.utimes(file, PACKED, PACKED)
    var app = express()
    app.use(compression())
    app.use('/static/app/build/entry', entryStatic(directory))
    var server = http.createServer(app)
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/static/app/build/entry/app.entry.js`
  }

  afterEach(async function() {
    await Promise.all(servers.splice(0).map(server =>
      new Promise(resolve => server.close(resolve))))
    await Promise.all(directories.splice(0).map(directory =>
      fs.rm(directory, {recursive: true, force: true})))
  })

  it('makes the browser revalidate it and answers 304 while it is unchanged', async function() {
    var url = await deploy('load("321.1b680a6f6799084dd8b7.chunk.js")')
    var first = await get(url)
    expect(first.status).to.equal(200)
    expect(first.headers['cache-control']).to.equal('no-cache')
    expect(first.headers).to.not.have.property('last-modified')
    var etag = first.headers.etag
    expect(etag).to.match(/^"[\w-]+"$/)
    var again = await get(url, {'If-None-Match': etag})
    expect(again.status).to.equal(304)
  })

  it('serves a new build with an entry of the same size and mtime', async function() {
    var oldBuild = 'load("321.1b680a6f6799084dd8b7.chunk.js")'
    var newBuild = 'load("321.889d73a000aed0f7d844.chunk.js")'
    expect(newBuild.length).to.equal(oldBuild.length)
    var cached = await get(await deploy(oldBuild))
    var etag = cached.headers.etag
    var response = await get(await deploy(newBuild), {
      'If-None-Match': etag, 'If-Modified-Since': PACKED.toUTCString()
    })
    expect(response.status).to.equal(200)
    expect(response.body).to.equal(newBuild)
    expect(response.headers.etag).to.not.equal(etag)
  })

  it('serves an entry rebuilt in place while the unit runs', async function() {
    var url = await deploy('load("321.1b680a6f6799084dd8b7.chunk.js")')
    var etag = (await get(url)).headers.etag
    var file = path.join(directories[0], 'app.entry.js')
    var newBuild = 'load("321.889d73a000aed0f7d844.chunk.js")'
    await fs.writeFile(file, newBuild)
    var rebuilt = new Date(PACKED.getTime() + 1000)
    await fs.utimes(file, rebuilt, rebuilt)
    var response = await get(url, {'If-None-Match': etag})
    expect(response.status).to.equal(200)
    expect(response.body).to.equal(newBuild)
  })

  it('fails the request instead of the unit when the entry is unreadable', async function() {
    if (process.getuid?.() === 0) {
      this.skip()
    }
    var url = await deploy('load("321.1b680a6f6799084dd8b7.chunk.js")')
    await fs.chmod(path.join(directories[0], 'app.entry.js'), 0)
    var response = await get(url)
    expect(response.status).to.be.at.least(400)
    expect(response.headers).to.not.have.property('etag')
  })
})
