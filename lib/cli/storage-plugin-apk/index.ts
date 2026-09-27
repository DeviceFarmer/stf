import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'storage-plugin-apk'

var describe = 'Start an APK storage plugin unit.'

var builder = function(yargs: Argv) {
  var os = require('os')

  return yargs
    .env('STF_STORAGE_PLUGIN_APK')
    .strict()
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7100
    })
    .option('storage-url', {
      alias: 'r'
    , describe: 'URL to the storage unit.'
    , type: 'string'
    , demand: true
    })
    .option('cache-dir', {
      describe: 'The location where to cache APK files.'
    , type: 'string'
    , default: os.tmpdir()
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_STORAGE_PLUGIN_APK_` (e.g. ' +
      '`STF_STORAGE_PLUGIN_APK_CACHE_DIR`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/storage/plugins/apk/index.js').default({
    port: argv.port
  , storageUrl: argv.storageUrl
  , cacheDir: argv.cacheDir
  })
}

export {command, describe, builder, handler}
