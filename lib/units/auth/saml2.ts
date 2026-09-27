/**
* Copyright © 2024-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import fs from 'fs'
import http from 'http'

import express from 'express'
import passport from 'passport'
import {Strategy as SamlStrategy} from '@node-saml/passport-saml'
import bodyParser from 'body-parser'
import _ from 'lodash'

import logger from '../../util/logger.js'
import urlutil from '../../util/urlutil.js'
import jwtutil from '../../util/jwtutil.js'

import dbapi from '../../db/api.js'
import type {VerifiedCallback, VerifyWithoutRequest} from '@node-saml/passport-saml'

interface Saml2AuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  saml: {
    entryPoint: string
    issuer: string
    certPath: string
    callbackUrl: string
    wantAssertionsSigned: boolean
    wantAuthnResponseSigned: boolean
    audience?: string
  }
}

export default function(options: Saml2AuthOptions) {
  var log = logger.createLogger('auth-saml2')
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

  var verify: VerifyWithoutRequest = function(profile, done: VerifiedCallback) {
    return done(null, profile as Record<string, unknown>)
  }

  var samlConfig = {
    entryPoint: options.saml.entryPoint
  , issuer: options.saml.issuer
  , wantAssertionsSigned: options.saml.wantAssertionsSigned
  , wantAuthnResponseSigned: options.saml.wantAuthnResponseSigned
  , callbackUrl: options.saml.callbackUrl
    // the cert has to be in hand before the strategy is constructed
    // eslint-disable-next-line no-sync
  , idpCert: fs.readFileSync(options.saml.certPath).toString()
  }

  if (options.saml.audience) {
    samlConfig = _.merge(samlConfig, {
      audience: options.saml.audience
    })
  }

  var logoutVerify: VerifyWithoutRequest = function(profile, done: VerifiedCallback) {
    done(new Error('SAML logout is not supported'))
  }
  var mySamlStrategy = new SamlStrategy(samlConfig, verify, logoutVerify)
  app.get('/auth/saml/metadata', function(req, res) {
    res.type('application/xml')
    res.send((mySamlStrategy.generateServiceProviderMetadata(null)))
  })

  app.use(bodyParser.urlencoded({extended: false}))
  app.use(passport.initialize())

  passport.serializeUser(function(user, done) {
    done(null, user)
  })
  passport.deserializeUser(function(user, done) {
    done(null, user as Express.User)
  })

  passport.use(mySamlStrategy)

  app.use(passport.authenticate('saml', {
    failureRedirect: '/auth/saml/'
  , session: false
  }))

  app.disable('x-powered-by')

  app.post(
    '/auth/saml/callback'
  , function(req, res) {
      if (req.user!.email) {
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
        log.warn('Missing email in profile', req.user)
        res.redirect('/auth/saml/')
      }
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
