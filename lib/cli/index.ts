/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'
import Promise from 'bluebird'

var require = createRequire(import.meta.url)

Promise.config({cancellation: true})
Promise.longStackTraces()

var _argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <command> [options]')
  .strict()
  .command(require('./api/index.js'))
  .command(require('./app/index.js'))
  .command(require('./auth-ldap/index.js'))
  .command(require('./auth-mock/index.js'))
  .command(require('./auth-oauth2/index.js'))
  .command(require('./auth-openid/index.js'))
  .command(require('./auth-saml2/index.js'))
  .command(require('./groups-engine/index.js'))
  .command(require('./device/index.js'))
  .command(require('./doctor/index.js'))
  .command(require('./generate-fake-device/index.js'))
  .command(require('./generate-fake-user/index.js'))
  .command(require('./generate-fake-group/index.js'))
  .command(require('./local/index.js'))
  .command(require('./log-rethinkdb/index.js'))
  .command(require('./migrate/index.js'))
  .command(require('./notify-hipchat/index.js'))
  .command(require('./notify-slack/index.js'))
  .command(require('./poorxy/index.js'))
  .command(require('./processor/index.js'))
  .command(require('./provider/index.js'))
  .command(require('./reaper/index.js'))
  .command(require('./storage-plugin-apk/index.js'))
  .command(require('./storage-plugin-image/index.js'))
  .command(require('./storage-s3/index.js'))
  .command(require('./storage-temp/index.js'))
  .command(require('./triproxy/index.js'))
  .command(require('./websocket/index.js'))
  .demandCommand(1, 'Must provide a valid command.')
  .help('h', 'Show help.')
  .alias('h', 'help')
  .version('V', 'Show version.', require('../../package').version)
  .alias('V', 'version')
  .argv
