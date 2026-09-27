import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'notify-slack'

var describe = 'Start a Slack notifier unit.'

var builder = function(yargs: Argv) {
  var logger = require('../../util/logger.js').default

  return yargs
    .env('STF_NOTIFY_SLACK')
    .strict()
    .option('channel', {
      alias: 'c'
    , describe: 'Slack channel.'
    , type: 'string'
    , default: process.env.SLACK_CHANNEL
    , demand: true
    })
    .option('connect-sub', {
      alias: 's'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , type: 'array'
    , demand: true
    })
    .option('priority', {
      alias: 'p'
    , describe: 'Minimum log level.'
    , type: 'number'
    , default: logger.Level.IMPORTANT
    })
    .option('token', {
      alias: 't'
    , describe: 'Slack API token.'
    , type: 'string'
    , default: process.env.SLACK_TOKEN
    , demand: true
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_NOTIFY_SLACK_` (e.g. ' +
      '`STF_NOTIFY_SLACK_CHANNEL`). Legacy environment variables like ' +
      'SLACK_TOKEN are still accepted, too, but consider them ' +
      'deprecated.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/notify/slack.js').default({
    token: argv.token
  , channel: argv.channel
  , priority: argv.priority
  , endpoints: {
      sub: argv.connectSub
    }
  })
}

export {command, describe, builder, handler}
