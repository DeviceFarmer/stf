var Promise = require('bluebird')

module.exports.periodicNotify = function(promise, interval, notify) {
  var timer = setInterval(notify, interval)

  return Promise.resolve(promise).finally(function() {
    clearInterval(timer)
  })
}
