import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'log-rethinkdb'

var describe = 'Start a RethinkDB log unit.'

var builder = function(yargs: Argv) {
  var logger = require('../../util/logger.js').default

  return yargs
    .env('STF_LOG_RETHINKDB')
    .strict()
    .option('connect-sub', {
      alias: 's'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('priority', {
      alias: 'p'
    , describe: 'Minimum log level.'
    , type: 'number'
    , default: logger.Level.IMPORTANT
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_LOG_RETHINKDB_` (e.g. ' +
      '`STF_LOG_RETHINKDB_PRIORITY`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/log/rethinkdb.js').default({
    priority: argv.priority
  , endpoints: {
      sub: argv.connectSub
    }
  })
}

export {command, describe, builder, handler}
