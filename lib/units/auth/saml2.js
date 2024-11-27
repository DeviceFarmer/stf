/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var fs = require('fs')
var http = require('http')

var express = require('express')
var passport = require('passport')
var SamlStrategy = require('@node-saml/passport-saml').Strategy
var bodyParser = require('body-parser')
var _ = require('lodash')

var logger = require('../../util/logger')
var urlutil = require('../../util/urlutil')
var jwtutil = require('../../util/jwtutil')

const dbapi = require('../../db/api')

module.exports = function(options) {
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

  var verify = function(profile, done) {
    return done(null, profile)
  }

  var samlConfig = {
    entryPoint: options.saml.entryPoint
  , issuer: options.saml.issuer
  }

  if (options.saml.certPath) {
    samlConfig = _.merge(samlConfig, {
      idpCert: fs.readFileSync(options.saml.certPath).toString()
    })
  }

  if (options.saml.callbackUrl) {
    samlConfig = _.merge(samlConfig, {
      callbackUrl: options.saml.callbackUrl
    })
  }
  else {
    samlConfig = _.merge(samlConfig, {
      path: '/auth/saml/callback'
    })
  }

  var mySamlStrategy = new SamlStrategy(samlConfig, verify)
  app.get('/auth/saml/metadata', function(req, res) {
    res.type('application/xml')
    res.send((mySamlStrategy.generateServiceProviderMetadata()))
  })

  app.use(bodyParser.urlencoded({extended: false}))
  app.use(passport.initialize())

  passport.serializeUser(function(user, done) {
    done(null, user)
  })
  passport.deserializeUser(function(user, done) {
    done(null, user)
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
      if (req.user.email) {
        res.redirect(urlutil.addParams(options.appUrl, {
          jwt: jwtutil.encode({
            payload: {
              email: req.user.email
            , name: req.user.email.split('@', 1).join('')
            }
          , secret: options.secret
          , header: {
              exp: Date.now() + 24 * 3600
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
