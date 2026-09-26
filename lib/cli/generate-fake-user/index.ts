/**
* Copyright © 2019 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'
import type Bluebird from 'bluebird'

var require = createRequire(import.meta.url)

var command = 'generate-fake-user'

var builder = function(yargs: Argv) {
  return yargs
    .strict()
    .option('n', {
      alias: 'number'
    , describe: 'How many users to create.'
    , type: 'number'
    , default: 1
    })
}

var handler = function(argv: CommandArgv<typeof builder, {number: number}>) {
  var logger = require('../../util/logger.js').default
  var log = logger.createLogger('cli:generate-fake-user')
  var fake: typeof import('../../util/fakeuser.js').default =
    require('../../util/fakeuser.js').default
  var n = argv.number

  function next(): Bluebird<null> {
    return fake.generate().then(function(email) {
      log.info('Created fake user "%s"', email)
      return --n ? next() : null
    })
  }

  return next()
    .then(function() {
      process.exit(0)
    })
    .catch(function(err: Error) {
      log.fatal('Fake user creation had an error:', err.stack)
      process.exit(1)
    })
}

export {command, builder, handler}
