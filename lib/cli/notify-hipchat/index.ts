import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'notify-hipchat'

var describe = 'Start a HipChat notifier unit.'

var builder = function(yargs: Argv) {
  var logger = require('../../util/logger.js').default

  return yargs
    .env('STF_NOTIFY_HIPCHAT')
    .strict()
    .option('connect-sub', {
      alias: 's'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , type: 'array'
    , demand: true
    })
    .option('notify-priority', {
      alias: 'n'
    , describe: 'Minimum log level to cause a notification.'
    , type: 'number'
    , default: logger.Level.WARNING
    })
    .option('priority', {
      alias: 'p'
    , describe: 'Minimum log level.'
    , type: 'number'
    , default: logger.Level.IMPORTANT
    })
    .option('room', {
      alias: 'r'
    , describe: 'HipChat room.'
    , type: 'string'
    , default: process.env.HIPCHAT_ROOM
    , demand: true
    })
    .option('token', {
      alias: 't'
    , describe: 'HipChat v2 API token.'
    , type: 'string'
    , default: process.env.HIPCHAT_TOKEN
    , demand: true
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_NOTIFY_HIPCHAT_` (e.g. ' +
      '`STF_NOTIFY_HIPCHAT_ROOM`). Legacy environment variables like ' +
      'HIPCHAT_TOKEN are still accepted, too, but consider them ' +
      'deprecated.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/notify/hipchat.js').default({
    token: argv.token
  , room: argv.room
  , priority: argv.priority
  , notifyPriority: argv.notifyPriority
  , endpoints: {
      sub: argv.connectSub
    }
  })
}

export {command, describe, builder, handler}
