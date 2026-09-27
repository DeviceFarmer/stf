/**
* Copyright © 2019-2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import dbapi from '../../../db/api.js'
import _ from 'lodash'
import apiutil from '../../../util/apiutil.js'
import lockutil from '../../../util/lockutil.js'
import Promise from 'bluebird'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import * as userapi from './user.js'
import type {GroupDocument, UserDocument} from '../../../types/stf.js'
import type {Response} from 'express'
import type {
  AddUserDeviceBody
, AlertMessageBody
, ApiHandler
, ApiLock
, ApiRequest
, EmailsBody
} from '../../../types/units-api.js'


/* --------------------------------- PRIVATE FUNCTIONS --------------------------------------- */

function userApiWrapper<B>(fn: ApiHandler<B>, req: ApiRequest<B>, res: Response) {
  const email = req.swagger.params.email.value

  dbapi.loadUser(email).then(function(user) {
    if (!user) {
      apiutil.respond(res, 404, 'Not Found (user)')
    }
    else {
      req.user = user
      fn(req, res)
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to wrap "%s": ', fn.name, err.stack)
  })
}

function getPublishedUser(
  user: UserDocument
, userEmail: string
, adminEmail: string
, fields: string | undefined
) {
  let publishedUser: Partial<UserDocument> = apiutil.publishUser(user)
  if (userEmail !== adminEmail) {
    publishedUser = _.pick(user, 'email', 'name', 'privilege')
  }
  if (fields) {
    publishedUser = _.pick(publishedUser, fields.split(','))
  }
  return publishedUser
}

function removeUser(email: string, req: ApiRequest, res: Response) {
  const groupOwnerState = req.swagger.params.groupOwner.value
  const anyGroupOwnerState = typeof groupOwnerState === 'undefined'
  const lock: ApiLock = {}

  function removeGroupUser(owner: string, id: string) {
    const lock: ApiLock = {}

    return dbapi.lockGroupByOwner(owner, id).then(function(stats) {
      if (!stats.replaced) {
        return apiutil.lightComputeStats(res, stats)
      }
      lock.group = stats.changes[0]!.new_val

      return owner === email ?
        dbapi.deleteUserGroup(id) :
        dbapi.removeGroupUser(id, email)
    })
    .finally(function() {
      lockutil.unlockGroup(lock)
    })
  }

  function deleteUserInDatabase(channel: string) {
    return dbapi.removeUserAccessTokens(email).then(function() {
      return dbapi.deleteUser(email).then(function() {
        req.options.pushdev.send([
          channel
        , wireutil.envelope(new wire.DeleteUserMessage(
            email
          ))
        ])
        return 'deleted'
      })
    })
  }

  function computeUserGroupOwnership(groups: GroupDocument[]) {
    if (anyGroupOwnerState) {
      return Promise.resolve(true)
    }
    return Promise.map(groups, function(group) {
      if (!groupOwnerState && group.owner.email === email) {
        return Promise.reject('filtered')
      }
      return !groupOwnerState || group.owner.email === email
    })
    .then(function(results) {
      return _.without(results, false).length > 0
    })
    .catch(function(err) {
      if (err === 'filtered') {
        return false
      }
      throw err
    })
  }

  if (req.user.email === email) {
    return Promise.resolve('forbidden')
  }
  return dbapi.lockUser(email).then(function(stats) {
    if (!stats.replaced) {
      return apiutil.lightComputeStats(res, stats)
    }
    const user: UserDocument = lock.user = stats.changes[0]!.new_val

    return dbapi.getGroupsByUser(user.email).then(function(groups: GroupDocument[]) {
      return computeUserGroupOwnership(groups).then(function(doContinue) {
        if (!doContinue) {
          return 'unchanged'
        }
        return Promise.each(groups, function(group) {
          return removeGroupUser(group.owner.email, group.id)
        })
        .then(function() {
          return deleteUserInDatabase(user.group)
        })
      })
    })
  })
  .finally(function() {
    lockutil.unlockUser(lock)
  })
}

/* --------------------------------- PUBLIC FUNCTIONS --------------------------------------- */

function getUserInfo(req: ApiRequest, email: string) {
  const fields = req.swagger.params.fields.value

  return dbapi.loadUser(email).then<Partial<UserDocument> | false>(function(user) {
    if (user) {
      return dbapi.getRootGroup().then(function(group) {
        return getPublishedUser(user, req.user.email, group.owner.email, fields)
      })
    }
    return false
  })
}

function updateUsersAlertMessage(req: ApiRequest<AlertMessageBody>, res: Response) {
  const lock: ApiLock = {}

  return dbapi.lockUser(req.user.email).then<void | 'not found'>(function(stats) {
    if (!stats.replaced) {
      return apiutil.lightComputeStats(res, stats)
    }
    lock.user = stats.changes[0]!.new_val

    return dbapi.updateUsersAlertMessage(req.body).then(function(stats) {
      if (stats.unchanged) {
        dbapi.loadUser(req.user.email).then(function(user) {
          apiutil.respond(res, 200, 'Unchanged (users alert message)',
            {alertMessage: user!.settings.alertMessage})
        })
      }
      else {
        apiutil.respond(res, 200, 'Updated (users alert message)',
          {alertMessage: stats.changes[0]!.new_val.settings.alertMessage})
      }
    })
    .catch(function(err) {
      apiutil.internalError(res, 'Failed to update users alert message: ', err.stack)
    })
  })
  .catch(function(err) {
    if (err !== 'busy') {
      throw err
    }
  })
  .finally(function() {
    lockutil.unlockUser(lock)
  })
}

function getUsersAlertMessage(req: ApiRequest, res: Response) {
  const fields = req.swagger.params.fields.value

  dbapi.getRootGroup().then(function(group) {
    return dbapi.loadUser(group.owner.email).then(function(user) {
      if (typeof user!.settings.alertMessage === 'undefined') {
        const lock: ApiLock = {}

        return dbapi.lockUser(req.user.email).then(function(stats) {
          if (!stats.replaced) {
            return apiutil.lightComputeStats(res, stats)
          }
          lock.user = stats.changes[0]!.new_val
          const alertMessage = {
            activation: 'False'
          , data: '*** this site is currently under maintenance, please wait ***'
          , level: 'Critical'
          }

          return dbapi.updateUsersAlertMessage(alertMessage).then(function(stats) {
            if (!stats.errors) {
              return stats.changes[0]!.new_val.settings.alertMessage
            }
            throw new Error('Failed to initialize users alert message')
          })
        })
        .finally(function() {
          lockutil.unlockUser(lock)
        })
      }
      return user!.settings.alertMessage
    })
    .then(function(alertMessage) {
      if (fields) {
        return _.pick(alertMessage, fields.split(','))
      }
      else {
        return alertMessage
      }
    })
    .then(function(alertMessage) {
      apiutil.respond(res, 200, 'Users Alert Message', {alertMessage: alertMessage})
    })
  })
  .catch(function(err) {
    if (err !== 'busy') {
      apiutil.internalError(res, 'Failed to get users alert message: ', err.stack)
    }
  })
}

function updateUserGroupsQuotas(req: ApiRequest, res: Response) {
  const email = req.swagger.params.email.value
  const duration =
    typeof req.swagger.params.duration.value !== 'undefined' ?
      req.swagger.params.duration.value :
      null
  const number =
    typeof req.swagger.params.number.value !== 'undefined' ?
      req.swagger.params.number.value :
      null
  const repetitions =
    typeof req.swagger.params.repetitions.value !== 'undefined' ?
      req.swagger.params.repetitions.value :
      null
  const lock: ApiLock = {}

  lockutil.lockUser(email, res, lock).then(function(lockingSuccessed) {
    if (lockingSuccessed) {
      return dbapi.updateUserGroupsQuotas(email, duration, number, repetitions)
        .then(function(stats) {
          if (stats.replaced) {
            return apiutil.respond(res, 200, 'Updated (user quotas)', {
              user: apiutil.publishUser(stats.changes[0]!.new_val)
            })
          }
          if ((duration === null || duration === lock.user!.groups.quotas.allocated.duration) &&
              (number === null || number === lock.user!.groups.quotas.allocated.number) &&
              (repetitions === null || repetitions === lock.user!.groups.quotas.repetitions)
             ) {
            return apiutil.respond(res, 200, 'Unchanged (user quotas)', {user: {}})
          }
          return apiutil.respond(
            res
          , 400
          , 'Bad Request (quotas must be >= actual consumed resources)')
        })
    }
    return false
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to update user groups quotas: ', err.stack)
  })
  .finally(function() {
    lockutil.unlockUser(lock)
  })
}

function updateDefaultUserGroupsQuotas(req: ApiRequest, res: Response) {
  const duration =
    typeof req.swagger.params.duration.value !== 'undefined' ?
      req.swagger.params.duration.value :
      null
  const number =
    typeof req.swagger.params.number.value !== 'undefined' ?
      req.swagger.params.number.value :
      null
  const repetitions =
    typeof req.swagger.params.repetitions.value !== 'undefined' ?
      req.swagger.params.repetitions.value :
      null
  const lock: ApiLock = {}

  lockutil.lockUser(req.user.email, res, lock).then(function(lockingSuccessed) {
    if (lockingSuccessed) {
      return dbapi.updateDefaultUserGroupsQuotas(req.user.email, duration, number, repetitions)
        .then(function(stats) {
          if (stats.replaced) {
            return apiutil.respond(res, 200, 'Updated (user default quotas)', {
              user: apiutil.publishUser(stats.changes[0]!.new_val)
            })
          }
          return apiutil.respond(res, 200, 'Unchanged (user default quotas)', {user: {}})
        })
    }
    return false
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to update default user groups quotas: ', err.stack)
  })
  .finally(function() {
    lockutil.unlockUser(lock)
  })
}

function getUserByEmail(req: ApiRequest, res: Response) {
  const email = req.swagger.params.email.value

  getUserInfo(req, email).then(function(user) {
    if (user) {
      apiutil.respond(res, 200, 'User Information', {user: user})
    }
    else {
      apiutil.respond(res, 404, 'Not Found (user)')
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to get user: ', err.stack)
  })
}

function getUsers(req: ApiRequest, res: Response) {
  const fields = req.swagger.params.fields.value

  dbapi.getUsers().then(function(users) {
    return dbapi.getRootGroup().then(function(group) {
      apiutil.respond(res, 200, 'Users Information', {
        users: users.map(function(user) {
          return getPublishedUser(user, req.user.email, group.owner.email, fields)
        })
      })
    })
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to get users: ', err.stack)
  })
}

function createUser(req: ApiRequest, res: Response) {
  const email = req.swagger.params.email.value
  const name = req.swagger.params.name.value

  dbapi.createUser(email, name, req.user.ip).then(function(stats) {
    if (!stats.inserted) {
      apiutil.respond(res, 403, 'Forbidden (user already exists)')
    }
    else {
      apiutil.respond(res, 201, 'Created (user)', {
        user: apiutil.publishUser(stats.changes[0]!.new_val)
      })
    }
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to create user: ', err.stack)
  })
}

function deleteUsers(req: ApiRequest<EmailsBody>, res: Response) {
  const emails = apiutil.getBodyParameter(req.body, 'emails')
  const target = apiutil.getQueryParameter(req.swagger.params.redirected) ? 'user' : 'users'

  function removeUsers(emails: string[]) {
    let results: unknown[] = []

    return Promise.each(emails, function(email) {
      return removeUser(email, req, res).then(function(result) {
        results.push(result)
      })
    })
    .then(function() {
      results = _.without(results, 'unchanged')
      if (!results.length) {
        return apiutil.respond(res, 200, `Unchanged (${target})`)
      }
      results = _.without(results, 'not found')
      if (!results.length) {
        return apiutil.respond(res, 404, `Not Found (${target})`)
      }
      results = _.without(results, 'forbidden')
      if (!results.length) {
        apiutil.respond(res, 403, `Forbidden (${target})`)
      }
      return apiutil.respond(res, 200, `Deleted (${target})`)
    })
    .catch(function(err) {
      if (err !== 'busy') {
        throw err
      }
    })
  }

  (function() {
    if (typeof emails === 'undefined') {
      return dbapi.getEmails().then(function(emails) {
        return removeUsers(emails)
      })
    }
    else {
      return removeUsers(_.without(emails.split(','), ''))
    }
  })()
  .catch(function(err) {
    apiutil.internalError(res, `Failed to delete ${target}: `, err.stack)
  })
}

function deleteUser(req: ApiRequest<EmailsBody>, res: Response) {
  apiutil.redirectApiWrapper('email', deleteUsers, req, res)
}

function createUserAccessToken(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.createAccessToken, req, res)
}

function deleteUserAccessToken(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.deleteAccessToken, req, res)
}

function deleteUserAccessTokens(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.deleteAccessTokens, req, res)
}

function getUserAccessToken(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.getAccessToken, req, res)
}

function getUserAccessTokens(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.getAccessTokens, req, res)
}

function getUserDevices(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.getUserDevices, req, res)
}

function getUserDevice(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.getUserDeviceBySerial, req, res)
}

function addUserDevice(req: ApiRequest<AddUserDeviceBody>, res: Response) {
  userApiWrapper(userapi.addUserDevice, req, res)
}

function deleteUserDevice(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.deleteUserDeviceBySerial, req, res)
}

function remoteConnectUserDevice(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.remoteConnectUserDeviceBySerial, req, res)
}

function remoteDisconnectUserDevice(req: ApiRequest, res: Response) {
  userApiWrapper(userapi.remoteDisconnectUserDeviceBySerial, req, res)
}

export {
    updateUserGroupsQuotas
  , updateDefaultUserGroupsQuotas
  , getUsers
  , getUsersAlertMessage
  , updateUsersAlertMessage
  , getUserByEmail
  , getUserInfo
  , createUser
  , deleteUser
  , deleteUsers
  , createUserAccessToken
  , deleteUserAccessToken
  , deleteUserAccessTokens
  , getUserAccessTokens as getUserAccessTokensV2
  , getUserAccessToken
  , getUserDevices as getUserDevicesV2
  , getUserDevice
  , addUserDevice as addUserDeviceV3
  , deleteUserDevice
  , remoteConnectUserDevice
  , remoteDisconnectUserDevice
}
