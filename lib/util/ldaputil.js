var util = require('util')

var ldapts = require('ldapts')
var Promise = require('bluebird')

function InvalidCredentialsError(user) {
  Error.call(this, util.format('Invalid credentials for user "%s"', user))
  this.name = 'InvalidCredentialsError'
  this.user = user
  Error.captureStackTrace(this, InvalidCredentialsError)
}

util.inherits(InvalidCredentialsError, Error)

// Export
module.exports.InvalidCredentialsError = InvalidCredentialsError

// Export
module.exports.login = function(options, username, password) {
  function tryConnect() {
    var client = new ldapts.Client({
          url: options.url
        , timeout: options.timeout
        , connectTimeout: options.timeout
        })

    if (!options.bind.dn) {
      return Promise.resolve(client)
    }

    return Promise.resolve(client.bind(options.bind.dn, options.bind.credentials))
      .return(client)
  }

  function tryFind(client) {
    var filter = new ldapts.AndFilter({
          filters: [
            new ldapts.EqualityFilter({
              attribute: 'objectClass'
            , value: options.search.objectClass
            })
          , new ldapts.EqualityFilter({
              attribute: options.search.field
            , value: username
            })
          ]
        })

    if (options.search.filter) {
      filter.filters.push(ldapts.FilterParser.parseString(options.search.filter))
    }

    return Promise.resolve(client.search(options.search.dn, {
        scope: options.search.scope
      , filter: filter
      }))
      .then(function(result) {
        if (!result.searchEntries.length) {
          throw new InvalidCredentialsError(username)
        }

        return result.searchEntries[0]
      })
  }

  function tryBind(client, user) {
    return Promise.resolve(client.bind(user.dn, password))
      .return(user)
      .catch(function() {
        throw new InvalidCredentialsError(username)
      })
  }

  return tryConnect().then(function(client) {
    return tryFind(client)
      .then(function(user) {
        return tryBind(client, user)
      })
      .finally(function() {
        return client.unbind()
      })
  })
}

// Export
module.exports.email = function(user) {
  return user.mail || user.email || user.userPrincipalName
}
