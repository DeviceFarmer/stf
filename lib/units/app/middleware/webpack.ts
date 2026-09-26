//
// Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import {createRequire} from 'module'
import path from 'path'
import url from 'url'

import webpack from 'webpack'
import mime from 'mime'
import Promise from 'bluebird'
import _ from 'lodash'
import MemoryFileSystem from 'memory-fs'
import type express from 'express'

import logger from '../../../util/logger.js'
import lifecycle from '../../../util/lifecycle.js'

var require = createRequire(import.meta.url)

var globalOptions = require('../../../../webpack.config.mts').webpack

type OutputMemoryFileSystem = MemoryFileSystem & webpack.OutputFileSystem

// Similar to webpack-dev-middleware, but integrates with our custom
// lifecycle, behaves more like normal express middleware, and removes
// all unnecessary features.
export default function(localOptions?: webpack.Configuration) {
  var log = logger.createLogger('middleware:webpack')
  var options = _.defaults(localOptions || {}, globalOptions)

  var compiler = webpack(options)
  var fs = compiler.outputFileSystem = new MemoryFileSystem() as OutputMemoryFileSystem

  var valid = false
  var queue: {resolve: () => void}[] = []

  log.info('Creating bundle')
  var watching = compiler.watch(options.watchDelay, function(err) {
    if (err) {
      log.fatal('Webpack had an error', err.stack)
      lifecycle.fatal()
    }
  }) as webpack.Watching

  lifecycle.observe(function() {
    if (watching.watcher) {
      watching.watcher.close()
    }
  })

  function doneListener(stats: webpack.Stats) {
    process.nextTick(function() {
      if (valid) {
        log.info(stats.toString(options.stats))

        if (stats.hasErrors()) {
          log.error('Bundle has errors')
        }
        else if (stats.hasWarnings()) {
          log.warn('Bundle has warnings')
        }
        else {
          log.info('Bundle is now valid')
        }

        queue.forEach(function(pending) {
          pending.resolve()
        })
      }
    })

    valid = true
  }

  function invalidate() {
    if (valid) {
      log.info('Bundle is now invalid')
      valid = false
    }
  }

  compiler.hooks.done.tap('done', doneListener)
  compiler.hooks.invalid.tap('invalid', invalidate)
  compiler.hooks.compile.tap('compile', invalidate)

  function bundle() {
    if (valid) {
      return Promise.resolve()
    }

    log.info('Waiting for bundle to finish')
    var resolve_: () => void
    var promise = new Promise(function(resolve) {
      resolve_ = resolve
    })
    queue.push({resolve: resolve_!})
    return promise
  }

  return function(req: express.Request, res: express.Response, next: express.NextFunction) {
    var parsedUrl = url.parse(req.url)

    var target = path.join(
      compiler.outputPath
    , parsedUrl.pathname as string
    )

    bundle()
      .then(function() {
        try {
          // dev-only middleware, mounted just when there is no prebuilt bundle
          // eslint-disable-next-line no-sync
          var body = fs.readFileSync(target)
          res.set('Content-Type', mime.getType(target) || 'application/octet-stream')
          return res.end(body)
        }
        catch (err) {
          return next()
        }
      })
      .catch(next)
  }
}
