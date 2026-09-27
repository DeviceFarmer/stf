/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'
import util from 'util'

import express from 'express'

import logger from '../../../../util/logger.js'
import requtil from '../../../../util/requtil.js'

import parseCrop from './param/crop.js'
import parseGravity from './param/gravity.js'
import get from './task/get.js'
import transform from './task/transform.js'

interface ImagePluginOptions {
  port: number
  storageUrl: string
  cacheDir: string
  concurrency: number
}

export default function(options: ImagePluginOptions) {
  var log = logger.createLogger('storage:plugins:image')
  var app = express()
  var server = http.createServer(app)

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.disable('x-powered-by')

  app.get(
    '/s/image/:id/:name'
  , requtil.limit(options.concurrency, function(req: express.Request, res: express.Response) {
      var orig = util.format(
        '/s/blob/%s/%s'
      , req.params.id
      , req.params.name
      )
      return get(orig, options)
        .then(function(stream) {
          return transform(stream, {
            crop: parseCrop(req.query.crop as string | undefined)
          , gravity: parseGravity(req.query.gravity as string | undefined)
          })
        })
        .then(function(out) {
          res.status(200)

          if (typeof req.query.download !== 'undefined') {
            res.set('Content-Disposition',
              'attachment; filename="' + req.params.name + '"')
          }

          out.pipe(res)
        })
        .catch(function(err) {
          log.error(
            'Unable to transform resource "%s"'
          , req.params.id
          , err.stack
          )
          res.status(500)
            .json({
              success: false
            })
        })
    })
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
