import http from 'node:http'
import type {AddressInfo} from 'node:net'

import {expect} from 'chai'
import sinon from 'sinon'
import {once} from 'node:events'
import {WebSocket, WebSocketServer} from 'ws'

import poorxy from '../../lib/units/poorxy/index.js'

describe('poorxy', function() {
  var target: http.Server, server: http.Server, origin: string
  let sockets: WebSocketServer

  before(function(done) {
    target = http.createServer(function(req, res) {
      res.end(req.url)
    })
    sockets = new WebSocketServer({server: target})
    sockets.on('connection', (socket, req) => {
      socket.send(JSON.stringify({url: req.url, headers: req.headers}))
      socket.close()
    })
    target.listen(0, '127.0.0.1', function() {
      var targetUrl = 'http://127.0.0.1:' + (target.address() as AddressInfo).port
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
        , websocketUrl: targetUrl
        , iosScreenRoutes: {'/ios/ios-0123456789ab/screen': targetUrl + '/'}
        })
      }
      finally {
        stub.restore()
      }

      server.once('listening', function() {
        origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
        done()
      })
    })
  })

  after(function(done) {
    sockets.close()
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
  , ['/socket.io/?EIO=4&transport=polling', '']
  , ['/', '/app-target']
  ].forEach(function(route) {
    it('should proxy ' + route[0] + ' to ' + route[1], async function() {
      var response = await fetch(origin + route[0], {method: 'POST'})
      expect(response.status).to.equal(200)
      expect(await response.text()).to.equal(route[1]! + route[0]!)
    })
  })

  ;['/ios/ios-0123456789ab/screen', '/socket.io/?EIO=4&transport=websocket'].forEach(route => {
    it('forwards the authenticated WebSocket at ' + route, async() => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + route, {
        headers: {Origin: origin, Cookie: 'session=test-session', Authorization: 'Bearer test'}
      })
      const message = once(ws, 'message')
      const closed = once(ws, 'close')
      const [data] = await message
      const forwarded = JSON.parse(data.toString())
      expect(forwarded.url).to.equal(route.startsWith('/ios/') ? '/' : route)
      expect(forwarded.headers.origin).to.equal(origin)
      expect(forwarded.headers.cookie).to.equal('session=test-session')
      expect(forwarded.headers.authorization).to.equal('Bearer test')
      await closed
    })
  })

  it('rejects unknown iOS screen routes instead of opening another backend', async() => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ios/ios-ffffffffffff/screen')
    const [error] = await once(ws, 'error')
    expect(error.message).to.contain('404')
  })
})
