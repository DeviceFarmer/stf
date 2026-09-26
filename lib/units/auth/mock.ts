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
import * as basicAuth from 'basic-auth'

import logger from '../../util/logger.js'
import requtil from '../../util/requtil.js'
import jwtutil from '../../util/jwtutil.js'
import pathutil from '../../util/pathutil.js'
import urlutil from '../../util/urlutil.js'
import lifecycle from '../../util/lifecycle.js'

import dbapi from '../../db/api.js'

interface MockAuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  mock: {
    useBasicAuth?: boolean
    basicAuth: {
      username?: string
      password?: string
    }
  }
}

export default function(options: MockAuthOptions) {
  var log = logger.createLogger('auth-mock')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  // BasicAuth Middleware
  var basicAuthMiddleware = function(
    req: express.Request
  , res: express.Response
  , next: express.NextFunction
  ) {
    function unauthorized(res: express.Response) {
      res.set('WWW-Authenticate', 'Basic realm=Authorization Required')
      return res.sendStatus(401)
    }

    var header = req.headers.authorization
    var user = header ? basicAuth.parse(header) : null

    if (!user || !user.name || !user.pass) {
      return unauthorized(res)
    }

    if (user.name === options.mock.basicAuth.username &&
        user.pass === options.mock.basicAuth.password) {
      return next()
    }
    else {
      return unauthorized(res)
    }
  }

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/mock/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use('/static/auth/mock', serveStatic(pathutil.resource('auth/mock')))

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  if (options.mock.useBasicAuth) {
    app.use(basicAuthMiddleware)
  }

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/mock/')
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

  app.get('/auth/mock/', function(req, res) {
    res.render('index')
  })

  app.post('/auth/api/v1/mock', requtil.validators.mockLoginValidator, function(
    req: express.Request
  , res: express.Response
  ) {
    var log = logger.createLogger('auth-mock')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req)
          .then(function() {
            return dbapi.checkUserBeforeLogin(req.body)
          })
          .then(function(isValidCredential) {
            if (!isValidCredential) {
              return Promise.reject('InvalidCredentialsError')
            }
            return isValidCredential
          })
          .then(function() {
            log.info('Authenticated "%s"', req.body.email)
            var token = jwtutil.encode({
              payload: {
                email: req.body.email
              , name: req.body.name
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
          .catch(function(err) {
            if (err === 'InvalidCredentialsError') {
              log.warn('Authentication failure for "%s"', req.body.email)
              res.status(400)
                .json({
                  success: false
                , error: 'InvalidCredentialsError'
                })
            }
            else {
              log.error('Unexpected error', err.stack)
              res.status(500)
                .json({
                  success: false
                , error: 'ServerError'
                })
            }
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
