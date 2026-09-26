/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import Promise from 'bluebird'
import type {Request} from 'express'
import {body, validationResult} from 'express-validator'
import type {Result} from 'express-validator'

interface ValidationError extends Error {
  errors: Result
}

type ValidationErrorCtor = new(message: string, errors: Result) => ValidationError

function ValidationError(
  this: ValidationError
, message: string
, errors: Result
) {
  Error.call(this)
  this.message = message
  this.name = 'ValidationError'
  this.errors = errors
  Error.captureStackTrace(this, ValidationError)
}

util.inherits(ValidationError, Error)

var validators = {
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

var validate = function(req: Request) {
  return new Promise<void>(function(resolve, reject) {
    const errors = validationResult(req)

    if (errors.isEmpty()) {
      resolve()
    }
    else {
      reject(new (ValidationError as unknown as ValidationErrorCtor)('validation error', errors))
    }
  })
}

var limit = function<A extends unknown[]>(
  limit: number
, handler: (...args: A) => Promise<unknown>
): (...args: A) => void {
  var queue: IArguments[] = []
  var running = 0

  /* eslint no-use-before-define: 0 */
  function maybeNext() {
    while (running < limit && queue.length) {
      running += 1
      handler.apply(null, queue.shift() as unknown as A).finally(done)
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

interface RequUtil {
  validators: typeof validators
  ValidationError: ValidationErrorCtor
  validate: typeof validate
  limit: typeof limit
}

export default {validators, ValidationError, validate, limit} as unknown as RequUtil
