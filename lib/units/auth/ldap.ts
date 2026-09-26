/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'

import express from 'express'
import cookieSession from 'cookie-session'
import bodyParser from 'body-parser'
import serveStatic from 'serve-static'
// csurf exports the middleware factory directly up to 1.15.0 and as an ESM
// default from 1.16.1 on. Accept both, the declared range allows both.
import * as csurf from '@dr.pogodin/csurf'
var csrf = csurf.default || (csurf as unknown as typeof csurf.default)
import Promise from 'bluebird'

import logger from '../../util/logger.js'
import requtil from '../../util/requtil.js'
import ldaputil from '../../util/ldaputil.js'
import jwtutil from '../../util/jwtutil.js'
import pathutil from '../../util/pathutil.js'
import urlutil from '../../util/urlutil.js'
import lifecycle from '../../util/lifecycle.js'

import dbapi from '../../db/api.js'

interface LdapAuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  ldap: Parameters<typeof ldaputil.login>[0] & {
    username: {
      field: string
    }
  }
}

export default function(options: LdapAuthOptions) {
  var log = logger.createLogger('auth-ldap')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/ldap/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use('/static/auth/ldap', serveStatic(pathutil.resource('auth/ldap')))

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/ldap/')
  })

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

  app.get('/auth/ldap/', function(req, res) {
    res.render('index')
  })

  app.post('/auth/api/v1/ldap', requtil.validators.ldapLoginValidator, function(
    req: express.Request
  , res: express.Response
  ) {
    var log = logger.createLogger('auth-ldap')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req)
          .then(function() {
            return ldaputil.login(
              options.ldap
            , req.body.username
            , req.body.password
            )
          })
          .then(function(user) {
            log.info('Authenticated "%s"', ldaputil.email(user))
            var token = jwtutil.encode({
              payload: {
                email: ldaputil.email(user) as string
              , name: user[options.ldap.username.field] as string
              }
            , secret: options.secret
            , header: {
                exp: Date.now() + 24 * 3600 * 1000
              }
            })
            res.status(200)
              .json({
                success: true
              , redirect: urlutil.addParams(options.appUrl, {
                  jwt: token
                })
              })
          })
          .catch(requtil.ValidationError, function(err) {
            res.status(400)
              .json({
                success: false
              , error: 'ValidationError'
              , validationErrors: err.errors
              })
          })
          .catch(ldaputil.InvalidCredentialsError, function(err) {
            log.warn('Authentication failure for "%s"', err.user)
            res.status(400)
              .json({
                success: false
              , error: 'InvalidCredentialsError'
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
        break
      default:
        res.sendStatus(406)
        break
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
