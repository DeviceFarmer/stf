/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var util = require('util')
var url = require('url')

var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')
var request = require('@cypress/request')

var logger = require('../../../util/logger')

module.exports = syrup.serial()
  .define(function(options) {
    var log = logger.createLogger('device:support:storage')
    var plugin = Object.create(null)

    plugin.store = function(type, stream, meta) {
      var resolve_, reject_
      var promise = new Promise(function(resolve, reject) {
        resolve_ = resolve
        reject_ = reject
      })

      var args = {
        url: url.resolve(options.storageUrl, util.format('s/upload/%s', type))
      }

      var req = request.post(args, function(err, res, body) {
        if (err) {
          log.error('Upload to "%s" failed', args.url, err.stack)
          reject_(err)
        }
        else if (res.statusCode !== 201) {
          log.error('Upload to "%s" failed: HTTP %d', args.url, res.statusCode)
          reject_(new Error(util.format(
            'Upload to "%s" failed: HTTP %d'
          , args.url
          , res.statusCode
          )))
        }
        else {
          try {
            var result = JSON.parse(body)
            log.info('Uploaded to "%s"', result.resources.file.href)
            resolve_(result.resources.file)
          }
          catch (err) {
            log.error('Invalid JSON in response', err.stack, body)
            reject_(err)
          }
        }
      })

      req.form()
        .append('file', stream, meta)

      return promise
    }

    return plugin
  })
