import util from 'util'

import * as ldapts from 'ldapts'
import Promise from 'bluebird'

interface InvalidCredentialsError extends Error {
  user: string
}

type InvalidCredentialsErrorCtor = new(user: string) => InvalidCredentialsError

type LdapAttribute = ldapts.Entry[string]

interface LdapEmailFields {
  [attribute: string]: LdapAttribute | undefined
  mail?: LdapAttribute
  email?: LdapAttribute
  userPrincipalName?: LdapAttribute
}

interface LdapOptions {
  url: string
  timeout: number
  bind: {
    dn?: string
    credentials?: string
  }
  search: {
    dn: string
    scope: NonNullable<ldapts.SearchOptions['scope']>
    objectClass: string
    field: string
    filter?: string
  }
}

function InvalidCredentialsError(this: InvalidCredentialsError, user: string) {
  Error.call(this)
  this.message = util.format('Invalid credentials for user "%s"', user)
  this.name = 'InvalidCredentialsError'
  this.user = user
  Error.captureStackTrace(this, InvalidCredentialsError)
}

util.inherits(InvalidCredentialsError, Error)

// Export

// Export
var login = function(options: LdapOptions, username: string, password: string) {
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

  function tryFind(client: ldapts.Client) {
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
          throw new (InvalidCredentialsError as unknown as InvalidCredentialsErrorCtor)(username)
        }

        return result.searchEntries[0]!
      })
  }

  function tryBind(client: ldapts.Client, user: ldapts.Entry) {
    return Promise.resolve(client.bind(user.dn, password))
      .return(user)
      .catch(function() {
        throw new (InvalidCredentialsError as unknown as InvalidCredentialsErrorCtor)(username)
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
var email = function(user: LdapEmailFields) {
  return user.mail || user.email || user.userPrincipalName
}

interface LdapUtil {
  InvalidCredentialsError: InvalidCredentialsErrorCtor
  login: typeof login
  email: typeof email
}

export default {InvalidCredentialsError, login, email} as unknown as LdapUtil
