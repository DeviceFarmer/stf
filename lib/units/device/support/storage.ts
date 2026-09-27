/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'
import url from 'url'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'
import request from '@cypress/request'

import logger from '../../../util/logger.js'
import type {Readable} from 'stream'
import type FormData from 'form-data'
import type {DeviceOptions, Storage, StoredFile} from '../../../types/device.js'

export default syrup.serial()
  .define(function(options: DeviceOptions): Storage {
    var log = logger.createLogger('device:support:storage')
    var plugin: Storage = Object.create(null)

    plugin.store = function(type: string, stream: Readable, meta: FormData.AppendOptions) {
      var resolve_: (value: StoredFile) => void, reject_: (reason: unknown) => void
      var promise = new Promise<StoredFile>(function(resolve, reject) {
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
            log.error('Invalid JSON in response', (err as Error).stack, body)
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
