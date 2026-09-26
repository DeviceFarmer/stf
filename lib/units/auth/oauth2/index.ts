/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'

import express from 'express'
import passport from 'passport'

import logger from '../../../util/logger.js'
import urlutil from '../../../util/urlutil.js'
import jwtutil from '../../../util/jwtutil.js'
import Strategy from './strategy.js'

import dbapi from '../../../db/api.js'
import type {VerifyCallback} from 'passport-oauth2'

interface OAuth2AuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  domain?: string
  oauth: ConstructorParameters<typeof Strategy>[0]
}

export default function(options: OAuth2AuthOptions) {
  var log = logger.createLogger('auth-oauth2')
  var app = express()
  var server = http.createServer(app)

  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.get('/auth/contact', function(req, res) {
    dbapi.getRootGroup().then(function(group) {
      res.status(200)
        .json({
          success: true
        , contact: group.owner
        })
    })
    .catch(function(err) {
      log.error('Unexpected error', err.stack)
      res.status(500)
        .json({
          success: false
        , error: 'ServerError'
        })
      })
  })

  function verify(
    accessToken: string
  , refreshToken: string
  , profile: Express.User
  , done: VerifyCallback
  ) {
    done(null, profile)
  }

  passport.use(new Strategy(options.oauth, verify))

  app.use(passport.initialize())
  app.use(passport.authenticate('oauth2', {
    failureRedirect: '/auth/oauth/'
  , session: false
  }))

  app.disable('x-powered-by')

  function isEmailAllowed(email: string | undefined): email is string {
    if (email) {
      if (options.domain) {
        return email.endsWith(options.domain)
      }
      return true
    }
    return false
  }

  app.get(
    '/auth/oauth/callback'
  , function(req, res) {
      if (isEmailAllowed(req.user!.email)) {
        res.redirect(urlutil.addParams(options.appUrl, {
          jwt: jwtutil.encode({
            payload: {
              email: req.user!.email
            , name: req.user!.email.split('@', 1).join('')
            }
          , secret: options.secret
          , header: {
              exp: Date.now() + 24 * 3600 * 1000
            }
          })
        }))
      }
      else {
        log.warn('Missing or disallowed email in profile', req.user)
        res.render('rejected-email')
      }
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
