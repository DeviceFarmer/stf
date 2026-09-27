/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'
import stream from 'stream'
import url from 'url'

import Promise from 'bluebird'
import request from '@cypress/request'

export default function(path: string, options: {storageUrl: string}) {
  return new Promise<stream.PassThrough>(function(resolve, reject) {
    var res = request.get(url.resolve(options.storageUrl, path))
    var ret = new stream.PassThrough()
    res.pipe(ret)

    res.on('response', function(res) {
        if (res.statusCode !== 200) {
          reject(new Error(util.format('HTTP %d', res.statusCode)))
        }
        else {
          resolve(ret)
        }
      })
      .on('error', reject)
  })
}
