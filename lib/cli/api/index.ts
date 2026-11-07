/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'api'

var describe = 'Start an API unit.'

var builder = function(yargs: Argv) {
  return yargs
    .env('STF_API')
    .strict()
    .option('connect-push', {
      alias: 'c'
    , describe: 'App-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub', {
      alias: 'u'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-push-dev', {
      alias: 'pd'
    , describe: 'Device-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub-dev', {
      alias: 'sd'
    , describe: 'Device-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7106
    })
    .option('secret', {
      alias: 's'
    , describe: 'The secret to use for auth JSON Web Tokens. Anyone who ' +
        'knows this token can freely enter the system if they want, so keep ' +
        'it safe.'
    , type: 'string'
    , default: process.env.SECRET
    , demand: true
    })
    .option('ssid', {
      alias: 'i'
    , describe: 'The name of the session ID cookie.'
    , type: 'string'
    , default: process.env.SSID || 'ssid'
    })
    .option('cookie-same-site', {
      describe: 'The SameSite attribute for session and CSRF cookies.'
    , type: 'string'
    , choices: ['lax', 'strict', 'none'] as const
    , default: (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase()
    , coerce: (val: string) => val.toLowerCase()
    })
    .option('cookie-secure', {
      describe: 'Whether to force session and CSRF cookies to be sent only over HTTPS.'
    , type: 'boolean'
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_API_` (e.g. ' +
      '`STF_API_PORT`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  var cookieSecure = argv.cookieSecure
  if (typeof cookieSecure === 'undefined' && typeof process.env.COOKIE_SECURE !== 'undefined') {
    cookieSecure = process.env.COOKIE_SECURE === 'true'
  }

  return require('../../units/api/index.js').default({
    port: argv.port
  , ssid: argv.ssid
  , secret: argv.secret
  , cookieSameSite: argv.cookieSameSite
  , cookieSecure: cookieSecure
  , endpoints: {
      push: argv.connectPush
    , sub: argv.connectSub
    , pushdev: argv.connectPushDev
    , subdev: argv.connectSubDev
    }
  })
}

export {command, describe, builder, handler}
