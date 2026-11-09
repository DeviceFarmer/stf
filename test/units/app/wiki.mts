import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'

import {expect} from 'chai'
import sinon from 'sinon'

import pathutil from '../../../lib/util/pathutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

describe('wiki rendering', function() {
  var server: http.Server, origin: string

  before(async function() {
    var restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {}})
    var hasBuild = sinon.stub(fs, 'existsSync').callThrough()
    hasBuild.withArgs(pathutil.resource('build')).returns(true)
    var createServer = http.createServer
    var stub = sinon.stub(http, 'createServer').callsFake(function(app) {
      server = createServer.call(http, app)
      return server
    })

    try {
      var unit = await importFresh(new URL('../../../lib/units/app/index.js', import.meta.url))
      unit.default({
        port: 0
      , ssid: 'wiki-test'
      , secret: 'wiki-test-secret'
      , authUrl: 'http://127.0.0.1/auth/mock/'
      })
    }
    finally {
      stub.restore()
      hasBuild.restore()
      restoreDb()
    }
    await new Promise<void>(function(resolve) {
      server.once('listening', resolve)
    })
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  })

  after(function(done) {
    server.close(done)
  })

  it('should render the wiki through the application Pug view', async function() {
    var response = await fetch(origin + '/static/wiki/' + encodeURIComponent('[en]-Help'), {
      redirect: 'manual'
    })
    var body = await response.text()
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.match(/^text\/html/)
    expect(body).to.contain('stf-docs')
    expect(body).to.contain('STF Help</h1>')
  })

  it('should link only to wiki pages that exist with the same case', function() {
    var pages = fs.readdirSync(pathutil.resource('wiki'))
    pages.filter(function(page) {
      return page.endsWith('.md')
    }).forEach(function(page) {
      var markdown = fs.readFileSync(pathutil.resource('wiki/' + page), 'utf8')
      for (var match of markdown.matchAll(/\]\(\/#!\/docs\/([^)#]+)\)/g)) {
        expect(pages, `${page} links to ${match[1]}`).to.include(`[en]-${match[1]}.md`)
      }
    })
  })

  it('should serve the browser and app store icons but not their data', async function() {
    for (var icon of [
      {path: '/static/app/browsers/icon/chrome.svg', type: 'image/svg+xml'}
    , {path: '/static/app/browser-icons/chrome.svg', type: 'image/svg+xml'}
    , {path: '/static/app/browsers/icon/yandex.svg', type: 'image/svg+xml'}
    , {path: '/static/app/browser-icons/yandex.svg', type: 'image/svg+xml'}
    , {path: '/static/app/appstores/icon/24x24/google-play-store.png', type: 'image/png'}
    , {path: '/static/app/appstores/icon/96x96/google-play-store.png', type: 'image/png'}
    ]) {
      var response = await fetch(origin + icon.path)
      await response.arrayBuffer()
      expect(response.status, icon.path).to.equal(200)
      expect(response.headers.get('content-type'), icon.path).to.equal(icon.type)
    }
    // Unknown paths fall through to the login redirect.
    var inventory = await fetch(origin + '/static/app/browsers/inventory.json', {
      redirect: 'manual'
    })
    await inventory.arrayBuffer()
    expect(inventory.status).to.equal(302)
  })
})
