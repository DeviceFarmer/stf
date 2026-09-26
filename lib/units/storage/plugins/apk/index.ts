/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'
import url from 'url'
import util from 'util'

import express from 'express'
import request from '@cypress/request'

import logger from '../../../../util/logger.js'
import download from '../../../../util/download.js'
import manifest from './task/manifest.js'

interface ApkPluginOptions {
  port: number
  storageUrl: string
  cacheDir: string
}

export default function(options: ApkPluginOptions) {
  var log = logger.createLogger('storage:plugins:apk')
  var app = express()
  var server = http.createServer(app)

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.disable('x-powered-by')

  app.get('/s/apk/:id/:name/manifest', function(req, res) {
    var orig = util.format(
      '/s/blob/%s/%s'
    , req.params.id
    , req.params.name
    )
    download(url.resolve(options.storageUrl, orig), {
        dir: options.cacheDir
      })
      .then(manifest)
      .then(function(data) {
        res.status(200)
          .json({
            success: true
          , manifest: data
          })
      })
      .catch(function(err) {
        log.error('Unable to read manifest of "%s"', req.params.id, err.stack)
        res.status(200)
          .json({
            success: false
          })
      })
  })

  app.get('/s/apk/:id/:name', function(req, res) {
    request(url.resolve(options.storageUrl, util.format(
      '/s/blob/%s/%s'
    , req.params.id
    , req.params.name
    )))
    .pipe(res)
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
