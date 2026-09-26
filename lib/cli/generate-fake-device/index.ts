import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'
import type Bluebird from 'bluebird'

var require = createRequire(import.meta.url)

var command = 'generate-fake-device <model>'

var builder = function(yargs: Argv) {
  return yargs
    .strict()
    .option('n', {
      alias: 'number'
    , describe: 'How many devices to create.'
    , type: 'number'
    , default: 1
    })
}

var handler = function(argv: CommandArgv<typeof builder, {model: string, number: number}>) {
  var logger = require('../../util/logger.js').default
  var log = logger.createLogger('cli:generate-fake-device')
  var fake: typeof import('../../util/fakedevice.js').default =
    require('../../util/fakedevice.js').default
  var n = argv.number

  function next(): Bluebird<null> {
    return fake.generate(argv.model).then(function(serial) {
      log.info('Created fake device "%s"', serial)
      return --n ? next() : null
    })
  }

  return next()
    .then(function() {
      process.exit(0)
    })
    .catch(function(err: Error) {
      log.fatal('Fake device creation had an error:', err.stack)
      process.exit(1)
    })
}

export {command, builder, handler}
