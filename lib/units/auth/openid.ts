/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'

import openid from 'openid'
import express from 'express'
import urljoin from 'url-join'

import logger from '../../util/logger.js'
import jwtutil from '../../util/jwtutil.js'
import urlutil from '../../util/urlutil.js'

interface OpenIdAuthOptions {
  port: number
  secret: string
  appUrl: string
  openid: {
    identifierUrl: string
  }
}

export default function(options: OpenIdAuthOptions) {
  var extensions = [new openid.SimpleRegistration({
    email: true
  , fullname: true
  })]

  var relyingParty = new openid.RelyingParty(
    urljoin(options.appUrl, '/auth/openid/verify')
  , null // Realm (optional, specifies realm for OpenID authentication)
  , false // Use stateless verification
  , false // Strict mode
  , extensions)

  var log = logger.createLogger('auth-openid')
  var app = express()

  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/openid/')
  })

  app.get('/auth/openid/', function(req, res) {
    log.info('openid identifier url: %s', options.openid.identifierUrl)
    relyingParty.authenticate(options.openid.identifierUrl, false, function(err, authUrl) {
      if (err) {
        res.send('Authentication failed')
      }
      else if (!authUrl) {
        res.send('Authentication failed')
      }
      else {
        log.info('redirect to authUrl: %s', options.openid.identifierUrl)
        res.redirect(authUrl)
      }
    })
  })

  app.get('/auth/openid/verify', function(req, res) {
    log.setLocalIdentifier(req.ip)

    relyingParty.verifyAssertion(req, function(err, result) {
      log.info('openid verify assertion')
      if (err || !result!.authenticated) {
        res.send('Authentication failed')
        return
      }
      var email = req.query['openid.sreg.email']
      var name = req.query['openid.sreg.fullname']
      log.info('Authenticated "%s:%s"', name, email)
      var token = jwtutil.encode({
        payload: {
          email: email as string
        , name: name as string
        }
      , secret: options.secret
      })
      res.redirect(urlutil.addParams(options.appUrl, {jwt: token}))
    })
  })

  http.createServer(app).listen(options.port)
  log.info('Listening on port %d', options.port)
}
