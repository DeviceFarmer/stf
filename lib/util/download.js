/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var fs = require('fs')

var Promise = require('bluebird')
var request = require('@cypress/request')
var temp = require('temp')

module.exports = function download(url, options) {
  var resolver = Promise.defer()
  var path = temp.path(options)

  function errorListener(err) {
    resolver.reject(err)
  }

  function closeListener() {
    resolver.resolve({
      path: path
    })
  }

  try {
    var req = request(url)

    var save = req.pipe(fs.createWriteStream(path))
      .on('error', errorListener)
      .on('close', closeListener)

    resolver.promise.finally(function() {
      save.removeListener('error', errorListener)
      save.removeListener('close', closeListener)
    })
  }
  catch (err) {
    resolver.reject(err)
  }

  return resolver.promise
}
