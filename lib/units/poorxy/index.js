const http = require('http')

const express = require('express')
const httpProxy = require('http-proxy')

const logger = require('../../util/logger')

module.exports = function(options) {
  let log = logger.createLogger('poorxy')
  let app = express()
  let server = http.createServer(app)
  let proxy = httpProxy.createProxyServer()

  proxy.on('error', function(err) {
    log.error('Proxy had an error', err.stack)
  })

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  ;['/static/auth/*', '/auth/*'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.authUrl
      })
    })
  })

  ;['/s/image/*'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storagePluginImageUrl
      })
    })
  })

  ;['/s/apk/*'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storagePluginApkUrl
      })
    })
  })

  ;['/s/*'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storageUrl
      })
    })
  })

  ;['/api/*'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.apiUrl
      })
    })
  })
  app.use(function(req, res) {
    proxy.web(req, res, {
      target: options.appUrl
    })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
