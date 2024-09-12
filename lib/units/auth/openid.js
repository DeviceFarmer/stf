const http = require('http')

const openid = require('openid-client')
const express = require('express')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')

const logger = require('../../util/logger')
const jwtutil = require('../../util/jwtutil')
const urlutil = require('../../util/urlutil')
const rateLimitConfig = require('../ratelimit')

module.exports = function(options) {
  const log = logger.createLogger('auth-openid')

  let app = express()
  let client
  const redirectUri = options.appUrl + 'auth/openid/callback'

  openid.Issuer.discover(options.openid.identifierUrl).then((keycloakIssuer) => {
    client = new keycloakIssuer.Client({
      client_id: options.openid.clientId
      , client_secret: options.openid.clientSecret
      , redirect_uris: [redirectUri]
      , response_types: ['code']
      , state: Math.random().toString()
    })
  }).catch((err) => {
    log.error('Couldn\'t discover.')
    log.error(err)
    process.exit(1)
  })

  app.use(rateLimitConfig)
  app.use(cookieParser())
  app.use(bodyParser.urlencoded({extended: false}))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.get('/', function(req, res) {
    res.redirect('/auth/openid/')
  })

  app.get('/auth/openid/', function(req, res) {
    const nonce = openid.generators.nonce()
    // store the nonce in your framework's session mechanism, if it is a cookie based solution
    // it should be httpOnly (not readable by javascript) and encrypted.
    if (client) {
      const url = client.authorizationUrl({
        scope: 'openid user_info'
        , response_mode: 'form_post'
        , nonce
      })
      res.cookie('openid-nonce', nonce, {
        httpOnly: true
      })
      res.redirect(url)
    }
    else {
      res.redirect('/auth/openid/')
    }
  })

  function callbackHandler(req, res) {
    log.setLocalIdentifier(req.ip)
    log.info('res.status %s', res.status)
    let nonce = req.cookies['openid-nonce']
    if(!nonce) {
      log.error('Auth failed! Missed nonce')
      res.send('Missed openid-nonce')
      return
    }

    log.info('redirectUri %s', redirectUri)

    const params = client.callbackParams(req)
    client.callback(redirectUri, params, {nonce}).then((tokenSet) => {
      let claims = tokenSet.claims()
      log.info('claims %s', claims)
      let token = jwtutil.encode({
        payload: {
          email: claims.email
          , name: claims.username
        }
        , secret: options.secret
      })
      log.info('Authenticated "%s"', claims.email)
      res.redirect(urlutil.addParams(options.appUrl, {jwt: token}))
    })
  }

  app.post('/auth/openid/callback', callbackHandler)
  app.get('/auth/openid/callback', callbackHandler)

  app.get('/auth/contact', function(req, res) {
    res.status(200)
      .json({
        success: true
        , contactUrl: options.supportUrl
      })
  })

  app.get('/auth/docs', function(req, res) {
    res.status(200)
      .json({
        success: true
        , docsUrl: options.docsUrl
      })
  })

http.createServer(app).listen(options.port)
log.info('Listening on port %d', options.port)
}
