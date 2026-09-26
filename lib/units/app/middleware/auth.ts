/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import jwtutil from '../../../util/jwtutil.js'
import urlutil from '../../../util/urlutil.js'

import dbapi from '../../../db/api.js'
import type express from 'express'

interface AppAuthOptions {
  secret: string
  authUrl: string
}

export default function(options: AppAuthOptions) {
  return function(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.query.jwt) {
      // Coming from auth client
      var data = jwtutil.decode(req.query.jwt as string, options.secret)
      var redir = urlutil.removeParam(req.url, 'jwt')
      if (data) {
        // Redirect once to get rid of the token
        dbapi.saveUserAfterLogin({
            name: data.name
          , email: data.email
          , ip: req.ip as string
          })
          .then(function() {
            req.session!.jwt = data
            req.sessionOptions.httpOnly = false
            res.redirect(redir)
          })
          .catch(next)
      }
      else {
        // Invalid token, forward to auth client
        res.redirect(options.authUrl)
      }
    }
    else if (req.session && req.session.jwt) {
      dbapi.loadUser(req.session.jwt.email)
        .then(function(user) {
          if (user) {
            // Continue existing session
            req.user = user
            return next()
          }
          else {
            // We no longer have the user in the database
            return res.redirect(options.authUrl)
          }
        })
        .catch(next)
    }
    else {
      // No session, forward to auth client
      res.redirect(options.authUrl)
    }
  }
}
