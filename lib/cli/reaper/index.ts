import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'reaper [name]'

var describe = 'Start a reaper unit.'

var builder = function(yargs: Argv) {
  var os = require('os')

  return yargs
    .env('STF_REAPER')
    .strict()
    .option('connect-push', {
      alias: 'p'
    , describe: 'Device-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub', {
      alias: 's'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('heartbeat-timeout', {
      alias: 't'
    , describe: 'Consider devices with heartbeat older than the timeout ' +
        'value dead. Given in milliseconds.'
    , type: 'number'
    , default: 30000
    })
    .option('name', {
      describe: 'An easily identifiable name for log output.'
    , type: 'string'
    , default: os.hostname()
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_REAPER_` (e.g. ' +
      '`STF_REAPER_CONNECT_PUSH`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/reaper/index.js').default({
    name: argv.name
  , heartbeatTimeout: argv.heartbeatTimeout
  , endpoints: {
      push: argv.connectPush
    , sub: argv.connectSub
    }
  })
}

export {command, describe, builder, handler}
