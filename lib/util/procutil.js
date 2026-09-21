var util = require('util')
var cp = require('child_process')

var Promise = require('bluebird')

var log = require('./logger').createLogger('util:procutil')

function ExitError(code) {
  Error.call(this)
  this.name = 'ExitError'
  this.code = code
  this.message = util.format('Exit code "%d"', code)
  Error.captureStackTrace(this, ExitError)
}

util.inherits(ExitError, Error)

// Export
module.exports.ExitError = ExitError

// Export
module.exports.fork = function(filename, args) {
  log.info('Forking "%s %s"', filename, args.join(' '))

  var resolve_, reject_
  var promise = new Promise(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var proc = cp.fork.apply(cp, arguments)

  function sigintListener() {
    proc.kill('SIGINT')
  }

  function sigtermListener() {
    proc.kill('SIGTERM')
  }

  process.on('SIGINT', sigintListener)
  process.on('SIGTERM', sigtermListener)

  proc.on('error', function(err) {
    reject_(err)
    proc.kill()
  })

  proc.on('exit', function(code, signal) {
    if (signal) {
      resolve_(code)
    }
    else if (code > 0 && code !== 130 && code !== 143) {
      reject_(new ExitError(code))
    }
    else {
      resolve_(code)
    }
  })

  var wrappedPromise = promise
    .finally(function() {
      process.removeListener('SIGINT', sigintListener)
      process.removeListener('SIGTERM', sigtermListener)
    })

  wrappedPromise.stop = function() {
    proc.kill()
    return wrappedPromise.reflect()
  }

  return wrappedPromise
}

// Export
module.exports.gracefullyKill = function(proc, timeout) {
  function killer(signal) {
    var resolve_
    var promise = new Promise(function(resolve) {
      resolve_ = resolve
    })

    function onExit() {
      resolve_()
    }

    proc.once('exit', onExit)
    proc.kill(signal)

    return promise.finally(function() {
      proc.removeListener('exit', onExit)
    })
  }

  return killer('SIGTERM')
    .timeout(timeout)
    .catch(function() {
      return killer('SIGKILL')
        .timeout(timeout)
    })
}
