var Promise = require('bluebird')

var logger = require('./logger')
var log = logger.createLogger('util:lifecycle')
var _ = require('lodash')

// How long the observers get in total before the process leaves without them
var SHUTDOWN_TIMEOUT = 10000

function Lifecycle() {
  this.observers = []
  this.ending = false
  this.shutdownTimeout = SHUTDOWN_TIMEOUT
  process.on('SIGINT', this.graceful.bind(this))
  process.on('SIGTERM', this.graceful.bind(this))
}

Lifecycle.prototype.share = function(name, emitter, options) {
  var opts = _.assign({
      end: true
    , error: true
    }
  , options
  )

  if (opts.end) {
    emitter.on('end', function() {
      if (!this.ending) {
        log.fatal('%s ended; we shall share its fate', name)
        this.fatal()
      }
    }.bind(this))
  }

  if (opts.error) {
    emitter.on('error', function(err) {
      if (!this.ending) {
        log.fatal('%s had an error', name, err.stack)
        this.fatal()
      }
    }.bind(this))
  }

  if (emitter.end) {
    this.observe(function() {
      emitter.end()
    })
  }

  return emitter
}

// Runs every shutdown observer and resolves once they are all done with, however they end. One
// observer that throws or never settles used to keep the whole unit alive; a shutdown is not the
// place to insist every last thing succeeded.
Lifecycle.prototype.settle = function() {
  var timeout = this.shutdownTimeout

  return Promise.all(this.observers.map(function(fn) {
    return Promise.try(fn).catch(function(err) {
      log.error('Shutdown observer failed', err && err.stack || err)
    })
  }))
  .timeout(timeout)
  .catch(Promise.TimeoutError, function() {
    log.warn('Shutdown observers did not finish in %dms; exiting anyway', timeout)
  })
}

Lifecycle.prototype.graceful = function() {
  log.info('Winding down for graceful exit')

  this.ending = true

  return this.settle().then(function() {
    process.exit(0)
  })
}

Lifecycle.prototype.fatal = function() {
  log.fatal('Shutting down due to fatal error')
  this.ending = true
  process.exit(1)
}

Lifecycle.prototype.observe = function(promise) {
  this.observers.push(promise)
}

module.exports = new Lifecycle()
