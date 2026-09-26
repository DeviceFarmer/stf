/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import fs from 'fs'

import Promise from 'bluebird'
import request from '@cypress/request'
import temp from 'temp'

interface DownloadedFile {
  path: string
  name?: string
}

export default function download(url: string, options: temp.AffixOptions | string) {
  var resolve_!: (value: DownloadedFile) => void, reject_!: (reason: unknown) => void
  var promise = new Promise<DownloadedFile>(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var path = temp.path(options)

  function errorListener(err: Error) {
    reject_(err)
  }

  function closeListener() {
    resolve_({
      path: path
    })
  }

  try {
    var req = request(url)
      .on('error', errorListener)

    var save = req.pipe(fs.createWriteStream(path))
      .on('error', errorListener)
      .on('close', closeListener)

    promise.finally(function() {
      req.removeListener('error', errorListener)
      save.removeListener('error', errorListener)
      save.removeListener('close', closeListener)
    })
  }
  catch (err) {
    reject_(err)
  }

  return promise
}
