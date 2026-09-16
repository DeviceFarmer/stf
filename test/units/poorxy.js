var http = require('http')

var expect = require('chai').expect
var sinon = require('sinon')

var poorxy = require('../../lib/units/poorxy')

describe('poorxy', function() {
  var target
  var server
  var origin

  before(function(done) {
    target = http.createServer(function(req, res) {
      res.end(req.url)
    })
    target.listen(0, '127.0.0.1', function() {
      var targetUrl = 'http://127.0.0.1:' + target.address().port
      var createServer = http.createServer
      var stub = sinon.stub(http, 'createServer').callsFake(function(app) {
        server = createServer.call(http, app)
        return server
      })

      try {
        poorxy({
          port: 0
        , authUrl: targetUrl + '/auth-target'
        , storagePluginImageUrl: targetUrl + '/image-target'
        , storagePluginApkUrl: targetUrl + '/apk-target'
        , storageUrl: targetUrl + '/storage-target'
        , apiUrl: targetUrl + '/api-target'
        , appUrl: targetUrl + '/app-target'
        })
      }
      finally {
        stub.restore()
      }

      server.once('listening', function() {
        origin = 'http://127.0.0.1:' + server.address().port
        done()
      })
    })
  })

  after(function(done) {
    server.close(function() {
      target.close(done)
    })
  })

  ;[
    ['/auth/', '/auth-target']
  , ['/auth/mock/?next=devices', '/auth-target']
  , ['/static/auth/mock/style.css', '/auth-target']
  , ['/s/image/id/image.png', '/image-target']
  , ['/s/apk/id/app.apk/manifest', '/apk-target']
  , ['/s/upload/apk', '/storage-target']
  , ['/api/v1/devices', '/api-target']
  , ['/', '/app-target']
  ].forEach(function(route) {
    it('should proxy ' + route[0] + ' to ' + route[1], async function() {
      var response = await fetch(origin + route[0], {method: 'POST'})
      expect(response.status).to.equal(200)
      expect(await response.text()).to.equal(route[1] + route[0])
    })
  })
})
