/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var util = require('util')

var Promise = require('bluebird')

function ValidationError(message, errors) {
  Error.call(this, message)
  this.name = 'ValidationError'
  this.errors = errors
  Error.captureStackTrace(this, ValidationError)
}

util.inherits(ValidationError, Error)

const {body, validationResult} = require('express-validator')
module.exports.validators = {
  mockLoginValidator: [
    body('name', 'Invalid name').not().isEmpty()
  , body('email', 'Invalid email').isEmail()
  ]
, ldapLoginValidator: [
    body('username', 'Invalid username').not().isEmpty()
  , body('password', 'Invalid password').not().isEmpty()
  ]
, tempUrlValidator: [
    body('url', 'Invalid url').not().isEmpty()
  ]
}

module.exports.ValidationError = ValidationError

module.exports.validate = function(req) {
  return new Promise(function(resolve, reject) {
    const errors = validationResult(req)

    if (errors.isEmpty()) {
      resolve()
    }
    else {
      reject(new ValidationError('validation error', errors))
    }
  })
}

module.exports.limit = function(limit, handler) {
  var queue = []
  var running = 0

  /* eslint no-use-before-define: 0 */
  function maybeNext() {
    while (running < limit && queue.length) {
      running += 1
      handler.apply(null, queue.shift()).finally(done)
    }
  }

  function done() {
    running -= 1
    maybeNext()
  }

  return function() {
    queue.push(arguments)
    maybeNext()
  }
}
