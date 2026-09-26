//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import util from 'util'

import Promise from 'bluebird'
import split from 'split'
import type {Readable} from 'stream'
import type logger from './logger.js'

interface NoSuchLineError extends Error {}

function NoSuchLineError(this: NoSuchLineError, message?: string) {
  Error.call(this)
  this.message = message || ''
  this.name = 'NoSuchLineError'
  Error.captureStackTrace(this, NoSuchLineError)
}

util.inherits(NoSuchLineError, Error)

var readAll = function(stream: Readable) {
  var resolve_: (value: Buffer) => void, reject_: (reason: unknown) => void
  var promise = new Promise<Buffer>(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var collected = Buffer.alloc(0)

  function errorListener(err: Error) {
    reject_(err)
  }

  function endListener() {
    resolve_(collected)
  }

  function readableListener() {
    var chunk: Buffer | null
    while ((chunk = stream.read())) {
      collected = Buffer.concat([collected, chunk])
    }
  }

  stream.on('error', errorListener)
  stream.on('readable', readableListener)
  stream.on('end', endListener)

  readableListener()

  return promise.finally(function() {
    stream.removeListener('error', errorListener)
    stream.removeListener('readable', readableListener)
    stream.removeListener('end', endListener)
  })
}

var findLine = function(stream: Readable, re: RegExp) {
  var resolve_: (value: string) => void, reject_: (reason: unknown) => void
  var promise = new Promise<string>(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var piped = stream.pipe(split())

  function errorListener(err: Error) {
    reject_(err)
  }

  function endListener() {
    reject_(new (NoSuchLineError as unknown as new() => NoSuchLineError)())
  }

  function lineListener(line: string) {
    if (re.test(line)) {
      resolve_(line)
    }
  }

  piped.on('error', errorListener)
  piped.on('data', lineListener)
  piped.on('end', endListener)

  return promise.finally(function() {
    piped.removeListener('error', errorListener)
    piped.removeListener('data', lineListener)
    piped.removeListener('end', endListener)
    stream.unpipe(piped)
  })
}

var talk = function(log: logger.Instance, format: string, stream: Readable) {
  stream.pipe(split())
    .on('data', function(chunk: Buffer | string) {
      var line = chunk.toString().trim()
      if (line.length) {
        log.info(format, line)
      }
    })
}

interface StreamUtil {
  NoSuchLineError: new(message?: string) => NoSuchLineError
  readAll: typeof readAll
  findLine: typeof findLine
  talk: typeof talk
}

export default {NoSuchLineError, readAll, findLine, talk} as unknown as StreamUtil
