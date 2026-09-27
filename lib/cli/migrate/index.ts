/**
* Copyright © 2019-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {BootStrapEnv} from '../../types/stf.js'

var require = createRequire(import.meta.url)

var command = 'migrate'

var describe = 'Migrates the database to the latest version.'

var builder = function(yargs: Argv) {
  return yargs
}

var handler = function() {
  var logger = require('../../util/logger.js').default
  var log = logger.createLogger('cli:migrate')
  var db: typeof import('../../db/index.js').default = require('../../db/index.js').default
  var dbapi: typeof import('../../db/api.js').default = require('../../db/api.js').default
  const apiutil: typeof import('../../util/apiutil.js').default =
    require('../../util/apiutil.js').default
  const Promise: typeof import('bluebird') = require('bluebird')

  return db.setup()
    .then(function() {
      return new Promise(function(resolve, reject) {
        setTimeout(function() {
          return dbapi.getGroupByIndex(apiutil.ROOT, 'privilege').then(function(group) {
            // signatures of built-in objects are defined
            const env: BootStrapEnv = {
              STF_ROOT_GROUP_NAME: group ? group.name : 'Common'
            , STF_ADMIN_NAME: group ? group.owner.name : 'administrator'
            , STF_ADMIN_EMAIL: group ? group.owner.email : 'administrator@fakedomain.com'
            }
            for (const i in env) {
              if (process.env[i]) {
                env[i as keyof BootStrapEnv] = process.env[i]
              }
            }
            if (!group) {
              // root group does not exist, so bootstrap is created
              return dbapi.createBootStrap(env)
            }
            // bootstrap is updated with new signatures
            return dbapi.updateBootStrap(group, env)
          })
          .then(function() {
            resolve(true)
          })
          .catch(function(err) {
            reject(err)
          })
        }, 1000)
      })
    })
    .catch(function(err) {
      log.fatal('Migration had an error:', err.stack)
      process.exit(1)
    })
    .finally(function() {
      process.exit(0)
    })
}

export {command, describe, builder, handler}
