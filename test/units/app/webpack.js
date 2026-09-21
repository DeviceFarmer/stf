var fs = require('fs/promises')
var http = require('http')
var os = require('os')
var path = require('path')

var expect = require('chai').expect
var express = require('express')
var sinon = require('sinon')

var lifecycle = require('../../../lib/util/lifecycle')
var webpackMiddleware = require('../../../lib/units/app/middleware/webpack')

describe('development assets', function() {
  this.timeout(10000)

  var directory, server, origin, cleanup

  before(async function() {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-webpack-'))
    await fs.writeFile(path.join(directory, 'entry.js'),
      "require('./style.less'); require('./template.html'); module.exports = require('./template.pug')")
    await fs.writeFile(path.join(directory, 'style.less'),
      '@color: #123456; .dependency-check { color: @color; }')
    await fs.writeFile(path.join(directory, 'template.pug'),
      'section.dependency-check\n  strong Pug rendered this')
    await fs.writeFile(path.join(directory, 'template.html'),
      '<section><strong>HTML loaded this</strong></section>')

    var observe = sinon.stub(lifecycle, 'observe').callsFake(function(fn) {
      cleanup = fn
    })
    var middleware
    try {
      middleware = webpackMiddleware({
        entry: {
          'app.js': path.join(directory, 'entry.js')
        , 'app.unknown': path.join(directory, 'entry.js')
        }
      , output: {path: path.join(directory, 'build'), filename: '[name]'}
      , plugins: []
      })
    }
    finally {
      observe.restore()
    }

    server = http.createServer(express().use(middleware))
    await new Promise(function(resolve) {
      server.listen(0, resolve)
    })
    origin = 'http://127.0.0.1:' + server.address().port
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

  it('should compile Pug, HTML and Less and serve JavaScript with its MIME type', async function() {
    var response = await fetch(origin + '/app.js', {signal: AbortSignal.timeout(5000)})
    var body = await response.text()
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.match(/^(text|application)\/javascript/)
    expect(body).to.contain('<strong>Pug rendered this</strong>')
    expect(body).to.contain('<strong>HTML loaded this</strong>')
    expect(body).to.contain('#123456')
    expect(body).to.contain('module.exports = code;')
    expect(body).not.to.contain('Module build failed')
    expect(body).not.to.contain('Cannot find module')
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
