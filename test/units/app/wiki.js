var fs = require('fs')
var http = require('http')

var expect = require('chai').expect
var sinon = require('sinon')

var pathutil = require('../../../lib/util/pathutil')

describe('wiki rendering', function() {
  var server, origin

  before(function(done) {
    var dbPath = require.resolve('../../../lib/db/api')
    var cachedDb = require.cache[dbPath]
    require.cache[dbPath] = {exports: {}}
    var hasBuild = sinon.stub(fs, 'existsSync').callThrough()
    hasBuild.withArgs(pathutil.resource('build')).returns(true)
    var createServer = http.createServer
    var stub = sinon.stub(http, 'createServer').callsFake(function(app) {
      server = createServer.call(http, app)
      return server
    })

    try {
      require('../../../lib/units/app')({
        port: 0
      , ssid: 'wiki-test'
      , secret: 'wiki-test-secret'
      , authUrl: 'http://127.0.0.1/auth/mock/'
      })
    }
    finally {
      stub.restore()
      hasBuild.restore()
      if (cachedDb) {
        require.cache[dbPath] = cachedDb
      }
      else {
        delete require.cache[dbPath]
      }
    }
    server.once('listening', function() {
      origin = 'http://127.0.0.1:' + server.address().port
      done()
    })
  })

  after(function(done) {
    server.close(done)
  })

  it('should render the wiki through the application Pug view', async function() {
    var response = await fetch(origin + '/static/wiki/Home', {redirect: 'manual'})
    var body = await response.text()
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.match(/^text\/html/)
    expect(body).to.contain('stf-docs')
    expect(body).to.contain('<p>Welcome to the stf wiki!</p>')
  })
})
