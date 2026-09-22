var Promise = require('bluebird')

module.exports = function StorageServiceFactory($http, $upload) {
  var service = {}

  service.storeUrl = function(type, url) {
    return $http({
      url: '/s/download/' + type
    , method: 'POST'
    , data: {
        url: url
      }
    })
  }

  service.storeFile = function(type, files, options) {
    var resolve_, reject_
    var promise = new Promise(function(resolve, reject) {
      resolve_ = resolve
      reject_ = reject
    })
    var notify = null
    var input = options.filter ? files.filter(options.filter) : files

    if (input.length) {
      $upload.upload({
          url: '/s/upload/' + type
        , method: 'POST'
        , file: input
        })
        .then(
          function(value) {
            resolve_(value)
          }
        , function(err) {
            reject_(err)
          }
        , function(progressEvent) {
            if (notify) {
              notify(progressEvent)
            }
          }
        )
    }
    else {
      var err = new Error('No input files')
      err.code = 'no_input_files'
      reject_(err)
    }

    promise.progressed = function(listener) {
      notify = listener
      return promise
    }

    return promise
  }

  return service
}
