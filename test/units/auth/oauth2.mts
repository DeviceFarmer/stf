import http from 'node:http'
import type net from 'node:net'
import type {AddressInfo} from 'node:net'
import {Duplex} from 'node:stream'
import {createRequire} from 'node:module'
import {URL} from 'node:url'

import type express from 'express'
import * as chai from 'chai'
import sinon from 'sinon'

var expect = chai.expect
var require = createRequire(import.meta.url)
var {OAuth2} = require('oauth')

import {importFresh, mockModule} from '../../helpers/module-mock.mts'

mockModule(new URL('../../../lib/db/index.js', import.meta.url), {
  default: {
    run: function() {
      return Promise.resolve({})
    }
  }
})

mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
  default: {
    getRootGroup: function() {
      return Promise.resolve({
        owner: {
          name: 'STF Admin'
        , email: 'admin@example.org'
        }
      })
    }
  }
})

import type * as OAuth2Module from '../../../lib/units/auth/oauth2/index.js'

var oauth2Unit = await importFresh(
  new URL('../../../lib/units/auth/oauth2/index.js', import.meta.url)
) as typeof OAuth2Module

var createApp = oauth2Unit.createApp
var defaultExport = oauth2Unit.default

type OAuth2Options = Parameters<typeof createApp>[0]

import Strategy from '../../../lib/units/auth/oauth2/strategy.js'
import jwtutil from '../../../lib/util/jwtutil.js'

class MockSocket extends Duplex {
  _read() {
    // No-op for mock socket
  }

  _write(_chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
    cb()
  }
}

interface MockResponseResult {
  statusCode: number
  headers: http.OutgoingHttpHeaders
  body: string
}

function makeRequest(
  app: ReturnType<typeof createApp>
, url: string
, headers: http.IncomingHttpHeaders = {}
, beforeApp?: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<MockResponseResult> {
  return new Promise(function(resolve) {
    var socket = new MockSocket()
    var req = new http.IncomingMessage(socket as unknown as net.Socket)
    req.method = 'GET'
    req.url = url
    req.headers = Object.assign({host: 'localhost:7120'}, headers)
    req.connection = socket as unknown as http.IncomingMessage['connection']
    req.socket = socket as unknown as http.IncomingMessage['socket']

    var res = new http.ServerResponse(req)
    res.assignSocket(socket as unknown as Parameters<typeof res.assignSocket>[0])

    var body = ''
    socket._write = function(chunk, _enc, cb) {
      body += chunk.toString()
      cb()
    }

    res.on('finish', function() {
      resolve({
        statusCode: res.statusCode
      , headers: res.getHeaders()
      , body: body
      })
    })

    if (beforeApp) {
      beforeApp(req, res)
    }

    app(req, res)
  })
}

function extractCookieHeader(setCookieHeader: string | string[] | number | undefined): string {
  if (!setCookieHeader) {
    return ''
  }
  var cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [String(setCookieHeader)]
  return cookies.map(function(c) {
    return c.split(';')[0]
  }).join('; ')
}

describe('auth-oauth2', function() {
  var defaultOptions: OAuth2Options
    , tokenStub: sinon.SinonStub
    , profileStub: sinon.SinonStub

  beforeEach(function() {
    defaultOptions = {
      port: 0
    , secret: 'top-secret-auth-key'
    , ssid: 'stf_oauth_ssid'
    , appUrl: 'http://localhost:7100/'
    , domain: 'example.org'
    , oauth: {
        authorizationURL: 'https://auth.example.com/oauth2/v1/authorize'
      , tokenURL: 'https://auth.example.com/oauth2/v1/token'
      , userinfoURL: 'https://auth.example.com/oauth2/v1/userinfo'
      , clientID: 'test-client-id'
      , clientSecret: 'test-client-secret'
      , callbackURL: 'http://localhost:7120/auth/oauth/callback'
      , scope: ['openid', 'email', 'profile']
      , state: true
      }
    }

    tokenStub = sinon.stub(OAuth2.prototype, 'getOAuthAccessToken').callsFake(
      function(...args: unknown[]) {
        var callback = args[args.length - 1] as (
          err: unknown
        , token?: string
        , refresh?: string
        , params?: unknown
        ) => void
        callback(null, 'mock-access-token', 'mock-refresh-token', {})
      }
    )

    profileStub = sinon.stub(Strategy.prototype, 'userProfile').callsFake(
      function(_token: string, callback: (err?: unknown, profile?: Express.User) => void) {
        callback(null, {
          email: 'user@example.org'
        , email_verified: true
        } as unknown as Express.User)
      }
    )
  })

  afterEach(function() {
    tokenStub.restore()
    profileStub.restore()
  })

  describe('state parameter generation on authorization redirect', function() {
    it('should generate a 24-character state and bind it to a signed cookie when state: true'
    , async function() {
      var app = createApp(defaultOptions)
      var res = await makeRequest(app, '/auth/oauth/')

      expect(res.statusCode).to.equal(302)
      var location = String(res.headers.location)
      var redirectUrl = new URL(location)
      expect(redirectUrl.origin).to.equal('https://auth.example.com')
      expect(redirectUrl.pathname).to.equal('/oauth2/v1/authorize')

      var stateParam = redirectUrl.searchParams.get('state')
      expect(stateParam).to.be.a('string')
      expect(stateParam).to.have.lengthOf(24)

      var setCookie = res.headers['set-cookie']
      expect(setCookie).to.be.an('array')
      var cookies = setCookie as string[]
      expect(cookies.some(function(c) {
        return c.startsWith('stf_oauth_ssid=') &&
          c.includes('samesite=lax') &&
          c.includes('httponly')
      })).to.equal(true)
      expect(cookies.some(function(c) {
        return c.startsWith('stf_oauth_ssid.sig=')
      })).to.equal(true)
    })

    it('should not include state in redirect when state: false', async function() {
      var options = Object.assign({}, defaultOptions, {
        oauth: Object.assign({}, defaultOptions.oauth, {state: false})
      })
      var app = createApp(options)
      var res = await makeRequest(app, '/auth/oauth/')

      expect(res.statusCode).to.equal(302)
      var location = String(res.headers.location)
      var redirectUrl = new URL(location)
      expect(redirectUrl.searchParams.has('state')).to.equal(false)
    })
  })

  describe('callback verification with state parameter', function() {
    it('should authenticate successfully when state matches and redirect to appUrl with JWT'
    , async function() {
      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var redirectUrl = new URL(String(initRes.headers.location))
      var state = redirectUrl.searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var callbackRes = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })

      expect(callbackRes.statusCode).to.equal(302)
      var appLocation = new URL(String(callbackRes.headers.location))
      expect(appLocation.origin + appLocation.pathname).to.equal('http://localhost:7100/')

      var jwt = appLocation.searchParams.get('jwt')
      expect(jwt).to.be.a('string')
      var decoded = jwtutil.decode(jwt!, defaultOptions.secret) as {
        email: string
        name: string
      }
      expect(decoded.email).to.equal('user@example.org')
      expect(decoded.name).to.equal('user')
    })

    it('should consume state on use to prevent replay attacks', async function() {
      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var redirectUrl = new URL(String(initRes.headers.location))
      var state = redirectUrl.searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var firstAttempt = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })
      expect(firstAttempt.statusCode).to.equal(302)
      expect(String(firstAttempt.headers.location)).to.contain('jwt=')

      // Second attempt with updated session cookie (state consumed) must be rejected
      var updatedCookieHeader = extractCookieHeader(firstAttempt.headers['set-cookie'])
      var secondAttempt = await makeRequest(app, callbackPath, {
        cookie: updatedCookieHeader
      })
      expect(secondAttempt.statusCode).to.equal(302)
      expect(String(secondAttempt.headers.location)).to.equal('/auth/oauth/')
    })

    it('should reject callback with missing state parameter and redirect to /auth/oauth/'
    , async function() {
      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackRes = await makeRequest(app, '/auth/oauth/callback?code=good_code', {
        cookie: cookieHeader
      })

      expect(callbackRes.statusCode).to.equal(302)
      expect(String(callbackRes.headers.location)).to.equal('/auth/oauth/')
    })

    it('should reject callback with mismatched/forged state and redirect to /auth/oauth/'
    , async function() {
      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=forged_state_token_123'
      var callbackRes = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })

      expect(callbackRes.statusCode).to.equal(302)
      expect(String(callbackRes.headers.location)).to.equal('/auth/oauth/')
    })

    it('should reject callback with tampered session cookie and redirect to /auth/oauth/'
    , async function() {
      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var redirectUrl = new URL(String(initRes.headers.location))
      var state = redirectUrl.searchParams.get('state')!

      // Tampered cookie signature
      var tamperedCookie = 'stf_oauth_ssid=eyJmb28iOiJiYXIifQ==; stf_oauth_ssid.sig=bad_sig'

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var callbackRes = await makeRequest(app, callbackPath, {
        cookie: tamperedCookie
      })

      expect(callbackRes.statusCode).to.equal(302)
      expect(String(callbackRes.headers.location)).to.equal('/auth/oauth/')
    })

    it('should verify state across multiple auth replicas sharing the same secret'
    , async function() {
      var replicaA = createApp(defaultOptions)
      var replicaB = createApp(defaultOptions)

      // Step 1: User hits Replica A
      var initRes = await makeRequest(replicaA, '/auth/oauth/')
      var redirectUrl = new URL(String(initRes.headers.location))
      var state = redirectUrl.searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      // Step 2: Callback hits Replica B
      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var callbackRes = await makeRequest(replicaB, callbackPath, {
        cookie: cookieHeader
      })

      expect(callbackRes.statusCode).to.equal(302)
      var appLocation = new URL(String(callbackRes.headers.location))
      expect(appLocation.origin + appLocation.pathname).to.equal('http://localhost:7100/')
      var jwt = appLocation.searchParams.get('jwt')
      expect(jwt).to.be.a('string')
    })
  })

  describe('interaction with domain restriction and email verification', function() {
    it('should allow subdomain emails in domain and redirect to appUrl', async function() {
      profileStub.callsFake(
        function(_token: string, callback: (err?: unknown, profile?: Express.User) => void) {
          callback(null, {
            email: 'alice@team.example.org'
          , email_verified: true
          } as unknown as Express.User)
        }
      )

      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var state = new URL(String(initRes.headers.location)).searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var res = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })

      expect(res.statusCode).to.equal(302)
      var appLocation = new URL(String(res.headers.location))
      var jwt = appLocation.searchParams.get('jwt')
      var decoded = jwtutil.decode(jwt!, defaultOptions.secret) as {email: string}
      expect(decoded.email).to.equal('alice@team.example.org')
    })

    it('should reject email from a different domain and render rejected-email', async function() {
      profileStub.callsFake(
        function(_token: string, callback: (err?: unknown, profile?: Express.User) => void) {
          callback(null, {
            email: 'attacker@notexample.org'
          , email_verified: true
          } as unknown as Express.User)
        }
      )

      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var state = new URL(String(initRes.headers.location)).searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var res = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })

      expect(res.statusCode).to.equal(200)
      expect(res.body).to.contain('or rejected email address')
    })

    it('should reject unverified email and render rejected-email', async function() {
      profileStub.callsFake(
        function(_token: string, callback: (err?: unknown, profile?: Express.User) => void) {
          callback(null, {
            email: 'user@example.org'
          , email_verified: false
          } as unknown as Express.User)
        }
      )

      var app = createApp(defaultOptions)
      var initRes = await makeRequest(app, '/auth/oauth/')
      var state = new URL(String(initRes.headers.location)).searchParams.get('state')!
      var cookieHeader = extractCookieHeader(initRes.headers['set-cookie'])

      var callbackPath = '/auth/oauth/callback?code=good_code&state=' + state
      var res = await makeRequest(app, callbackPath, {
        cookie: cookieHeader
      })

      expect(res.statusCode).to.equal(200)
      expect(res.body).to.contain('or rejected email address')
    })
  })

  describe('OAuth callback error handling', function() {
    it('should handle access_denied cleanly by redirecting to /auth/oauth/', async function() {
      var app = createApp(defaultOptions)
      var errorPath = '/auth/oauth/callback?error=access_denied&error_description=User+denied'
      var res = await makeRequest(app, errorPath)

      expect(res.statusCode).to.equal(302)
      expect(String(res.headers.location)).to.equal('/auth/oauth/')
    })

    it('should handle server_error cleanly by redirecting to /auth/oauth/ without crashing'
    , async function() {
      var app = createApp(defaultOptions)
      var errorPath = '/auth/oauth/callback?error=server_error&error_description=IdP+unavailable'
      var res = await makeRequest(app, errorPath)

      expect(res.statusCode).to.equal(302)
      expect(String(res.headers.location)).to.equal('/auth/oauth/')
    })

    it('should delegate to next error handler if headers were already sent', async function() {
      var app = createApp(defaultOptions)
      var nextErrorHandlerCalled = false

      app.use(function(
        _err: unknown
      , _req: express.Request
      , res: express.Response
      , _next: express.NextFunction
      ) {
        nextErrorHandlerCalled = true
        res.end()
      })

      var errorPath = '/auth/oauth/callback?error=server_error&error_description=IdP+unavailable'
      var res = await makeRequest(app, errorPath, {}, function(_req, res) {
        res.writeHead(500)
      })

      expect(nextErrorHandlerCalled).to.equal(true)
      expect(res.statusCode).to.equal(500)
    })
  })

  describe('server startup and contact endpoint', function() {
    var server: http.Server

    afterEach(function(done) {
      if (server && server.listening) {
        server.close(done)
      }
      else {
        done()
      }
    })

    it('should expose /auth/contact and return root group owner', async function() {
      var app = createApp(defaultOptions)
      var res = await makeRequest(app, '/auth/contact')

      expect(res.statusCode).to.equal(200)
      var data = JSON.parse(res.body.slice(res.body.indexOf('\r\n\r\n') + 4))
      expect(data).to.deep.equal({
        success: true
      , contact: {
          name: 'STF Admin'
        , email: 'admin@example.org'
        }
      })
    })

    it('should listen on port when started via default export', async function() {
      server = defaultExport(Object.assign({}, defaultOptions, {port: 0}))
      await new Promise<void>(function(resolve) {
        server.once('listening', resolve)
      })

      var port = (server.address() as AddressInfo).port
      expect(port).to.be.a('number').and.be.greaterThan(0)
    })
  })
})
