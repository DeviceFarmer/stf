var fs = require('fs')

var Promise = require('bluebird')
var request = require('request').defaults({ rejectUnauthorized: false })
var progress = require('request-progress')
var temp = require('temp')
var logger = require('./logger')
var log = logger.createLogger('util:download')

module.exports = function download(url, options) {
  var resolver = Promise.defer()
  var path = temp.path(options)

  if(url.endsWith('.apk')){
    path += '.apk'
  }
  else if(url.endsWith('.ipa')){
    path += '.ipa'
  }
  log.info("Downloading " + url + " to " + path ) 
  function errorListener(err) {
    resolver.reject(err)
  }
  
  function progressListener(state) {
    if (state.total !== null) {
      resolver.progress({
        lengthComputable: true
      , loaded: state.received
      , total: state.total
      })
    }
    else {
      resolver.progress({
        lengthComputable: false
      , loaded: state.received
      , total: state.received
      })
    }
  }

  function closeListener() {
    resolver.resolve({
      path: path
    })
  }

  resolver.progress({
    percent: 0
  })

  try {
    var req = progress(request(url), {
        throttle: 100 // Throttle events, not upload speed
      })
      .on('progress', progressListener)

    resolver.promise.finally(function() {
      req.removeListener('progress', progressListener)
    })

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
