/**
* Copyright © 2019-2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import timeutil from '../../../util/timeutil.js'
import r from 'rethinkdb'
import _ from 'lodash'
import logger from '../../../util/logger.js'
import wireutil from '../../../wire/util.js'
import wire from '../../../wire/index.js'
import db from '../../../db/index.js'
import lifecycle from '../../../util/lifecycle.js'
import type {Socket} from 'zeromq/v5-compat.js'
import type {UserDocument, UserGroups, UserSettings} from '../../../types/stf.js'
import type {UserField} from '../../../types/wire.js'
import type {ChangeRow} from '../../../types/groups-engine.js'

type WatchedUser = Pick<UserDocument, 'email' | 'name' | 'privilege'> & {
  groups: Pick<UserGroups, 'quotas' | 'subscribed'>
  settings: Pick<UserSettings, 'alertMessage'>
}

export default function(pushdev: Socket) {
  const log = logger.createLogger('watcher-users')

  function sendUserChange(
    user: WatchedUser
  , isAddedGroup: boolean
  , groups: string[]
  , action: string
  , targets: string[]) {
    pushdev.send([
      wireutil.global
    , wireutil.envelope(
        new wire.UserChangeMessage(
          user as unknown as UserField
        , isAddedGroup
        , groups
        , action
        , targets
        , timeutil.now('nano')))
    ])
  }

  db.run(r
    .table('users')
    .pluck(
      'email'
    , 'name'
    , 'privilege'
    , {groups: ['quotas', 'subscribed']}
    , {settings: ['alertMessage']}
    )
    .changes(), function(err, cursor) {
    if (err) {
      throw err
    }
    return cursor
  })
  .then(function(cursor) {
    cursor.each(function(err, data: ChangeRow<WatchedUser>) {
      if (err) {
        if (lifecycle.ending) {
          return
        }
        throw err
      }
      if (data.old_val === null) {
        sendUserChange(data.new_val, false, [], 'created', ['settings'])
      }
      else if (data.new_val === null) {
        sendUserChange(data.old_val, false, [], 'deleted', ['settings'])
      }
      else {
        const targets: string[] = []

        if (!_.isEqual(
               data.new_val.groups.quotas.allocated
             , data.old_val.groups.quotas.allocated)) {
          targets.push('settings')
          targets.push('view')
        }
        else if (!_.isEqual(
                    data.new_val.groups.quotas.consumed
                  , data.old_val.groups.quotas.consumed)) {
          targets.push('view')
        }
        else if (data.new_val.groups.quotas.defaultGroupsNumber !==
          data.old_val.groups.quotas.defaultGroupsNumber ||
          data.new_val.groups.quotas.defaultGroupsDuration !==
          data.old_val.groups.quotas.defaultGroupsDuration ||
          data.new_val.groups.quotas.defaultGroupsRepetitions !==
          data.old_val.groups.quotas.defaultGroupsRepetitions ||
          data.new_val.groups.quotas.repetitions !==
          data.old_val.groups.quotas.repetitions ||
          !_.isEqual(data.new_val.groups.subscribed, data.old_val.groups.subscribed)) {
          targets.push('settings')
        }
        else if (!_.isEqual(
               data.new_val.settings.alertMessage
             , data.old_val.settings.alertMessage)) {
          targets.push('menu')
        }
        if (targets.length) {
          sendUserChange(
            data.new_val
          , data.new_val.groups.subscribed.length > data.old_val.groups.subscribed.length
          , _.xor(data.new_val.groups.subscribed, data.old_val.groups.subscribed)
          , 'updated'
          , targets)
        }
      }
    })
  })
  .catch(function(err) {
    log.error('An error occured during USERS table watching', err.stack)
  })
}
