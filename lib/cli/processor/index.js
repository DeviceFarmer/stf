module.exports.command = 'processor [name]'

module.exports.describe = 'Start a processor unit.'

module.exports.builder = function(yargs) {
  var os = require('os')

  return yargs
    .env('STF_PROCESSOR')
    .strict()
    .option('connect-app-dealer', {
      alias: 'a'
    , describe: 'App-side ZeroMQ DEALER endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-dev-dealer', {
      alias: 'd'
    , describe: 'Device-side ZeroMQ DEALER endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('name', {
      describe: 'An easily identifiable name for log output.'
    , type: 'string'
    , default: os.hostname()
    })
    .option('auto-restore-owner', {
      describe: 'Keep a device for the same user whenever it disappears while in use, not only ' +
        'when a reboot asked for it. Off by default: a device that disappears is released. ' +
        'Set it the same way on every processor: departures are load balanced across them, so a ' +
        'fleet that disagrees restores an arbitrary subset of them.'
    , type: 'boolean'
    , default: false
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_PROCESSOR_` (e.g. ' +
      '`STF_PROCESSOR_CONNECT_APP_DEALER`).')
}

module.exports.handler = function(argv) {
  return require('../../units/processor')({
    name: argv.name
  , autoRestoreOwner: argv.autoRestoreOwner
  , endpoints: {
      appDealer: argv.connectAppDealer
    , devDealer: argv.connectDevDealer
    }
  })
}
