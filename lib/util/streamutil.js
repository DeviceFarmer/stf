//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

var util = require('util')

var Promise = require('bluebird')
var split = require('split')

function NoSuchLineError(message) {
  Error.call(this)
  this.name = 'NoSuchLineError'
  this.message = message
  Error.captureStackTrace(this, NoSuchLineError)
}

util.inherits(NoSuchLineError, Error)

module.exports.NoSuchLineError = NoSuchLineError

module.exports.readAll = function(stream) {
  var resolve_, reject_
  var promise = new Promise(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var collected = Buffer.alloc(0)

  function errorListener(err) {
    reject_(err)
  }

  function endListener() {
    resolve_(collected)
  }

  function readableListener() {
    var chunk
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

module.exports.findLine = function(stream, re) {
  var resolve_, reject_
  var promise = new Promise(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var piped = stream.pipe(split())

  function errorListener(err) {
    reject_(err)
  }

  function endListener() {
    reject_(new NoSuchLineError())
  }

  function lineListener(line) {
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

module.exports.talk = function(log, format, stream) {
  stream.pipe(split())
    .on('data', function(chunk) {
      var line = chunk.toString().trim()
      if (line.length) {
        log.info(format, line)
      }
    })
}
