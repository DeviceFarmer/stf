import fs from 'node:fs/promises'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'
import express from 'express'
import sinon from 'sinon'

import lifecycle from '../../../lib/util/lifecycle.js'
import webpackMiddleware from '../../../lib/units/app/middleware/webpack.js'

describe('development assets', function() {
  this.timeout(10000)

  var directory: string, server: http.Server, origin: string, cleanup: (() => unknown) | undefined

  before(async function() {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-webpack-'))
    await fs.writeFile(path.join(directory, 'entry.ts'),
      "import './style.css'\nimport classes from './widget.module.css'\n" +
      "const typed: string = 'TypeScript compiled this'\nexport default [typed, classes.widget]")
    await fs.writeFile(path.join(directory, 'style.css'),
      '.dependency-check { color: #123456; }')
    await fs.writeFile(path.join(directory, 'widget.module.css'),
      '.widget { color: #654321; }')

    var observe = sinon.stub(lifecycle, 'observe').callsFake(function(fn) {
      cleanup = fn
    })
    var middleware
    try {
      middleware = webpackMiddleware({
        mode: 'development'
      , devtool: false
      , entry: {
          'app.js': path.join(directory, 'entry.ts')
        , 'app.unknown': path.join(directory, 'entry.ts')
        }
      , output: {path: path.join(directory, 'build'), filename: '[name]'}
      , plugins: []
      })
    }
    finally {
      observe.restore()
    }

    server = http.createServer(express().use(middleware))
    await new Promise<void>(function(resolve) {
      server.listen(0, resolve)
    })
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  })

  after(async function() {
    if (server) {
      await new Promise(function(resolve) {
        server.close(resolve)
      })
    }
    if (cleanup) {
      cleanup()
    }
    await fs.rm(directory, {recursive: true, force: true})
  })

  it('should compile TypeScript and CSS modules and serve JavaScript with its MIME type',
    async function() {
      var response = await fetch(origin + '/app.js', {signal: AbortSignal.timeout(5000)})
      var body = await response.text()
      expect(response.status).to.equal(200)
      expect(response.headers.get('content-type')).to.match(/^(text|application)\/javascript/)
      expect(body).to.contain('TypeScript compiled this')
      expect(body).not.to.contain('typed: string')
      expect(body).to.contain('#123456')
      expect(body).to.contain('#654321')
      expect(body).to.match(/widget-module__widget--/)
      expect(body).not.to.contain('Module build failed')
      expect(body).not.to.contain('webpackMissingModule')
    })

  it('should serve unknown extensions as binary data', async function() {
    var response = await fetch(origin + '/app.unknown')
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.equal('application/octet-stream')
    await response.arrayBuffer()
  })

  it('should pass missing assets to the next middleware', async function() {
    var response = await fetch(origin + '/missing.js')
    expect(response.status).to.equal(404)
    await response.text()
  })
})
