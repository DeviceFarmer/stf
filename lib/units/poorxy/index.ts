/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'

import express from 'express'
import httpProxy from 'http-proxy'

import logger from '../../util/logger.js'

interface PoorxyOptions {
  port: number
  appUrl: string
  apiUrl: string
  authUrl: string
  storageUrl: string
  storagePluginImageUrl: string
  storagePluginApkUrl: string
  websocketUrl: string
  iosScreenRoutes?: Record<string, string>
}

export default function(options: PoorxyOptions) {
  var log = logger.createLogger('poorxy')
  var app = express()
  var server = http.createServer(app)
  var proxy = httpProxy.createProxyServer()
  const routes = options.iosScreenRoutes || {}
  for (const [route, target] of Object.entries(routes)) {
    const url = new URL(target)
    if (!/^\/ios\/ios-[a-f0-9]{12}\/screen$/.test(route) ||
        url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/' || url.search || url.username || url.password) {
      throw new Error('iOS screen routes must point to a loopback HTTP listener')
    }
  }

  proxy.on('error', function(err, _req, response) {
    log.error('Proxy had an error', err.stack)
    if (response && 'writeHead' in response) {
      if (!response.headersSent) {
        response.writeHead(502)
      }
      response.end()
    }
    else {
      response?.destroy()
    }
  })

  server.on('upgrade', function(req, socket, head) {
    const target = routes[req.url || '']
    if (target) {
      req.url = '/'
      proxy.ws(req, socket, head, {target})
    }
    else if (req.url?.startsWith('/socket.io/')) {
      proxy.ws(req, socket, head, {target: options.websocketUrl})
    }
    else {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    }
  })

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.disable('x-powered-by')

  app.use('/socket.io', function(req, res) {
    // Keep the original path for Engine.IO HTTP polling as well as upgrades.
    req.url = req.originalUrl
    proxy.web(req, res, {target: options.websocketUrl})
  })

  ;['/static/auth/{*path}', '/auth/{*path}'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.authUrl
      })
    })
  })

  ;['/s/image/{*path}'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storagePluginImageUrl
      })
    })
  })

  ;['/s/apk/{*path}'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storagePluginApkUrl
      })
    })
  })

  ;['/s/{*path}'].forEach(function(route) {
    app.all(route, function(req, res) {
      proxy.web(req, res, {
        target: options.storageUrl
      })
    })
  })

  ;['/api/{*path}'].forEach(function(route) {
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
  return server
}
