import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'storage-s3'

var describe = 'Start an S3 storage unit.'

var builder = function(yargs: Argv) {
  return yargs
    .env('STF_STORAGE_S3')
    .strict()
    .option('bucket', {
      describe: 'S3 bucket name.'
    , type: 'string'
    , demand: true
    })
    .option('endpoint', {
      describe: 'S3 bucket endpoint.'
    , type: 'string'
    , demand: true
    })
    .option('max-file-size', {
      describe: 'Maximum file size to allow for uploads. Note that nginx ' +
        'may have a separate limit, meaning you should change both.'
    , type: 'number'
    , default: 1 * 1024 * 1024 * 1024
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7100
    })
    .option('region', {
      describe: 'S3 region.'
    , type: 'string'
    , default: 'us-east-1'
    })
    .option('force-path-style', {
      describe: 'Address buckets as a path instead of a subdomain. Required ' +
        'by S3 compatible services such as SeaweedFS, MinIO and Ceph.'
    , type: 'boolean'
    , default: false
    })
    .option('profile', {
      describe: 'AWS credentials profile name.'
    , type: 'string'
    , demand: true
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_STORAGE_S3_` (e.g. ' +
      '`STF_STORAGE_S3_PROFILE`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/storage/s3.js').default({
    port: argv.port
  , profile: argv.profile
  , bucket: argv.bucket
  , endpoint: argv.endpoint
  , forcePathStyle: argv.forcePathStyle
  , region: argv.region
  , maxFileSize: argv.maxFileSize
  })
}

export {command, describe, builder, handler}
