import http from 'node:http'
import fs from 'node:fs'
import type {AddressInfo} from 'node:net'

import * as chai from 'chai'
import sinon from 'sinon'
import yargs from 'yargs'

var expect = chai.expect

import jwtutil from '../../lib/util/jwtutil.js'
import pathutil from '../../lib/util/pathutil.js'
import cookieutil from '../../lib/util/cookieutil.js'
import * as appCli from '../../lib/cli/app/index.js'
import * as authMockCli from '../../lib/cli/auth-mock/index.js'
import * as localCli from '../../lib/cli/local/index.js'
import {authArgs} from '../../lib/cli/local/index.js'
import type AuthMock from '../../lib/units/auth/mock.js'
import type AppUnit from '../../lib/units/app/index.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

function parseCli(module: any, args: string[]): any {
  let parsed: any
  yargs(args)
    .exitProcess(false)
    .fail((message: string, error: Error) => {
      throw error || new Error(message)
    })
    .command(module.command, module.describe, module.builder, (argv: any) => {
      parsed = argv
    })
    .parseSync()
  return parsed
}

function request(options: {
  port: number
  path: string
  method?: string
  headers?: http.OutgoingHttpHeaders
  body?: string
}): Promise<{
  statusCode: number
  headers: http.IncomingHttpHeaders
  body: string
}> {
  return new Promise((resolve, reject) => {
    var req = http.request({
      host: '127.0.0.1'
    , port: options.port
    , path: options.path
    , method: options.method || 'GET'
    , headers: options.headers || {}
    }, function(res) {
      var data = ''
      res.setEncoding('utf8')
      res.on('data', function(chunk) {
        data += chunk
      })
      res.on('end', function() {
        resolve({
          statusCode: res.statusCode || 0
        , headers: res.headers
        , body: data
        })
      })
    })
    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function getCookies(headers: http.IncomingHttpHeaders): string[] {
  var raw = headers['set-cookie']
  if (!raw) {
    return []
  }
  return Array.isArray(raw) ? raw : [raw]
}

function findCookie(cookies: string[], name: string): string | null {
  var prefix = name + '='
  for (var i = 0; i < cookies.length; i++) {
    var c = cookies[i]
    if (c && c.startsWith(prefix)) {
      return c
    }
  }
  return null
}

describe('Cookie SameSite and Secure configuration', function() {
  describe('cookieutil helpers', function() {
    it('should correctly parse boolean values', function() {
      expect(cookieutil.parseBoolean(true)).to.equal(true)
      expect(cookieutil.parseBoolean(false)).to.equal(false)
      expect(cookieutil.parseBoolean('true')).to.equal(true)
      expect(cookieutil.parseBoolean('TRUE')).to.equal(true)
      expect(cookieutil.parseBoolean('1')).to.equal(true)
      expect(cookieutil.parseBoolean('yes')).to.equal(true)
      expect(cookieutil.parseBoolean('false')).to.equal(false)
      expect(cookieutil.parseBoolean('0')).to.equal(false)
      expect(cookieutil.parseBoolean('no')).to.equal(false)
      expect(cookieutil.parseBoolean('invalid')).to.equal(undefined)
      expect(cookieutil.parseBoolean(undefined)).to.equal(undefined)
    })

    it('should build session options that keep the legacy attributes by default', function() {
      var defaultOpts = cookieutil.sessionOptions({
        ssid: 'test-ssid'
      , secret: 'test-secret'
      })
      expect(defaultOpts.name).to.equal('test-ssid')
      expect(typeof defaultOpts.sameSite).to.equal('undefined')
      expect(typeof defaultOpts.secure).to.equal('undefined')

      var noneOpts = cookieutil.sessionOptions({
        ssid: 'test-ssid'
      , secret: 'test-secret'
      , cookieSameSite: 'none'
      })
      expect(noneOpts.sameSite).to.equal('none')
      // Left to cookie-session, which marks HTTPS requests Secure and never throws on HTTP
      expect(typeof noneOpts.secure).to.equal('undefined')

      var explicitSecure = cookieutil.sessionOptions({
        ssid: 'test-ssid'
      , secret: 'test-secret'
      , cookieSameSite: 'lax'
      , cookieSecure: true
      })
      expect(explicitSecure.secure).to.equal(true)
    })

    it('should build xsrf cookie options respecting protocol and explicit settings', function() {
      var httpReq = {protocol: 'http'} as any
      var httpsReq = {protocol: 'https'} as any

      expect(cookieutil.xsrfCookieOptions({}, httpReq)).to.deep.equal({})
      expect(cookieutil.xsrfCookieOptions({}, httpsReq)).to.deep.equal({})

      var laxHttps = cookieutil.xsrfCookieOptions({cookieSameSite: 'lax'}, httpsReq)
      expect(laxHttps).to.deep.equal({sameSite: 'lax'})

      var noneHttp = cookieutil.xsrfCookieOptions({cookieSameSite: 'none'}, httpReq)
      expect(noneHttp).to.deep.equal({sameSite: 'none'})

      var noneHttps = cookieutil.xsrfCookieOptions({cookieSameSite: 'none'}, httpsReq)
      expect(noneHttps).to.deep.equal({sameSite: 'none', secure: true})

      var explicitSecure = cookieutil.xsrfCookieOptions({cookieSecure: true}, httpReq)
      expect(explicitSecure).to.deep.equal({secure: true})

      var explicitInsecure = cookieutil.xsrfCookieOptions({cookieSecure: false}, httpsReq)
      expect(explicitInsecure).to.deep.equal({secure: false})
    })

    it('should only trust the proxy when a cookie option depends on it', function() {
      expect(cookieutil.needsProxyTrust({})).to.equal(false)
      expect(cookieutil.needsProxyTrust({cookieSameSite: 'lax'})).to.equal(false)
      expect(cookieutil.needsProxyTrust({cookieSameSite: 'none'})).to.equal(true)
      expect(cookieutil.needsProxyTrust({cookieSecure: false})).to.equal(true)
    })
  })

  describe('CLI option parsing', function() {
    var originalEnv: NodeJS.ProcessEnv

    beforeEach(function() {
      originalEnv = {...process.env}
    })

    afterEach(function() {
      process.env = originalEnv
    })

    it('should leave --cookie-same-site unset by default', function() {
      var appParsed = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      ])
      var authParsed = parseCli(authMockCli, [
        'auth-mock', '--secret', 's3cret', '--app-url', 'http://127.0.0.1:7105/'
      ])
      var localParsed = parseCli(localCli, ['local'])

      expect(typeof appParsed.cookieSameSite).to.equal('undefined')
      expect(typeof authParsed.cookieSameSite).to.equal('undefined')
      expect(typeof localParsed.cookieSameSite).to.equal('undefined')
      expect(typeof appParsed.cookieSecure).to.equal('undefined')
      expect(typeof authParsed.cookieSecure).to.equal('undefined')
      expect(typeof localParsed.cookieSecure).to.equal('undefined')
    })

    it('should parse and coerce --cookie-same-site none with mixed case', function() {
      var appParsed = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      , '--cookie-same-site', 'None'
      ])
      var authParsed = parseCli(authMockCli, [
        'auth-mock', '--secret', 's3cret', '--app-url', 'http://127.0.0.1:7105/'
      , '--cookie-same-site', 'NONE'
      ])

      expect(appParsed.cookieSameSite).to.equal('none')
      expect(authParsed.cookieSameSite).to.equal('none')
    })

    it('should parse --cookie-secure and --no-cookie-secure flags', function() {
      var appSecure = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      , '--cookie-secure'
      ])
      var appInsecure = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      , '--no-cookie-secure'
      ])

      expect(appSecure.cookieSecure).to.equal(true)
      expect(appInsecure.cookieSecure).to.equal(false)
    })

    it('should reject --cookie-same-site none with --no-cookie-secure', function() {
      expect(function() {
        parseCli(appCli, [
          'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
        , '--websocket-url', 'http://127.0.0.1:7110/'
        , '--cookie-same-site', 'none'
        , '--no-cookie-secure'
        ])
      }).to.throw(/requires secure cookies/)
    })

    it('should respect COOKIE_SAME_SITE and COOKIE_SECURE environment variables', function() {
      process.env.COOKIE_SAME_SITE = 'none'
      process.env.COOKIE_SECURE = 'true'

      var appParsed = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      ])
      var authParsed = parseCli(authMockCli, [
        'auth-mock', '--secret', 's3cret', '--app-url', 'http://127.0.0.1:7105/'
      ])

      expect(appParsed.cookieSameSite).to.equal('none')
      expect(authParsed.cookieSameSite).to.equal('none')
      expect(cookieutil.resolveCookieSecure(appParsed.cookieSecure)).to.equal(true)
      expect(cookieutil.resolveCookieSecure(authParsed.cookieSecure)).to.equal(true)
    })

    it('should respect STF_COOKIE_SAME_SITE and STF_COOKIE_SECURE env variables', function() {
      delete process.env.COOKIE_SAME_SITE
      delete process.env.COOKIE_SECURE
      process.env.STF_COOKIE_SAME_SITE = 'strict'
      process.env.STF_COOKIE_SECURE = '1'

      var appParsed = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      ])

      expect(appParsed.cookieSameSite).to.equal('strict')
      expect(cookieutil.resolveCookieSecure(appParsed.cookieSecure)).to.equal(true)
    })
  })

  describe('local CLI authArgs forwarding', function() {
    it('should forward cookieArgs to auth-mock and auth-ldap only', function() {
      var cookieArgs = ['--cookie-same-site', 'none', '--cookie-secure']

      var mockArgs = authArgs({
        authType: 'mock'
      , authPort: 7120
      , authSecret: 'test-secret'
      , publicIp: '127.0.0.1'
      , port: 7100
      , authOptions: '[]'
      }, cookieArgs)
      expect(mockArgs).to.include('--cookie-same-site')
      expect(mockArgs).to.include('--cookie-secure')

      var ldapArgs = authArgs({
        authType: 'ldap'
      , authPort: 7120
      , authSecret: 'test-secret'
      , publicIp: '127.0.0.1'
      , port: 7100
      , authOptions: '[]'
      }, cookieArgs)
      expect(ldapArgs).to.include('--cookie-same-site')
      expect(ldapArgs).to.include('--cookie-secure')

      var oauth2Args = authArgs({
        authType: 'oauth2'
      , authPort: 7120
      , authSecret: 'test-secret'
      , publicIp: '127.0.0.1'
      , port: 7100
      , authOptions: '[]'
      }, cookieArgs)
      expect(oauth2Args).to.not.include('--cookie-same-site')
      expect(oauth2Args).to.not.include('--cookie-secure')

      var saml2Args = authArgs({
        authType: 'saml2'
      , authPort: 7120
      , authSecret: 'test-secret'
      , publicIp: '127.0.0.1'
      , port: 7100
      , authOptions: '[]'
      }, cookieArgs)
      expect(saml2Args).to.not.include('--cookie-same-site')

      var openidArgs = authArgs({
        authType: 'openid'
      , authPort: 7120
      , authSecret: 'test-secret'
      , publicIp: '127.0.0.1'
      , port: 7100
      , authOptions: '[]'
      }, cookieArgs)
      expect(openidArgs).to.not.include('--cookie-same-site')
    })
  })

  describe('auth-mock cookie headers and CSRF verification', function() {
    var authMock: typeof AuthMock
      , restoreDbIndex: (() => void) | undefined
      , restoreDbApi: (() => void) | undefined
    var server: http.Server | null = null
    var port = 0

    before(async function() {
      restoreDbIndex = mockModule(new URL('../../lib/db/index.js', import.meta.url), {
        default: {
          run: function() {
            return Promise.resolve({})
          }
        }
      })
      restoreDbApi = mockModule(new URL('../../lib/db/api.js', import.meta.url), {
        default: {
          checkUserBeforeLogin: function() {
            return Promise.resolve(true)
          }
        , getRootGroup: function() {
            return Promise.resolve({owner: 'admin@example.com'})
          }
        }
      })

      authMock = (await importFresh(
        new URL('../../lib/units/auth/mock.js', import.meta.url)
      )).default
    })

    after(function() {
      restoreDbIndex?.()
      restoreDbApi?.()
    })

    afterEach(function(done) {
      if (server) {
        server.close(function() {
          server = null
          done()
        })
      }
      else {
        done()
      }
    })

    function startAuthMock(options: {
      cookieSameSite?: 'lax' | 'strict' | 'none'
      cookieSecure?: boolean
    }): Promise<number> {
      return new Promise(function(resolve) {
        var createServer = http.createServer
        var serverStub = sinon.stub(http, 'createServer').callsFake(function(...args: any[]) {
          server = createServer.apply(http, args as any)
          return server
        })

        try {
          authMock({
            port: 0
          , secret: 'test-secret'
          , ssid: 'ssid'
          , appUrl: 'http://127.0.0.1:7105/'
          , cookieSameSite: options.cookieSameSite
          , cookieSecure: options.cookieSecure
          , mock: {
              useBasicAuth: false
            , basicAuth: {}
            }
          })
        }
        finally {
          serverStub.restore()
        }

        server!.once('listening', function() {
          port = (server!.address() as AddressInfo).port
          resolve(port)
        })
      })
    }

    it('should keep the legacy cookie attributes by default', async function() {
      await startAuthMock({})
      for (var headers of [{}, {'x-forwarded-proto': 'https'}]) {
        var res = await request({port: port, path: '/auth/mock/', headers: headers})
        var cookies = getCookies(res.headers)
        var ssidCookie = findCookie(cookies, 'ssid')
        var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')

        expect(ssidCookie).to.not.include('samesite')
        expect(ssidCookie).to.not.include('secure')
        expect(xsrfCookie).to.not.include('SameSite')
        expect(xsrfCookie).to.not.include('Secure')
      }
    })

    it('should set SameSite=Lax explicitly when asked', async function() {
      await startAuthMock({cookieSameSite: 'lax'})
      var res = await request({port: port, path: '/auth/mock/'})
      var cookies = getCookies(res.headers)
      expect(findCookie(cookies, 'ssid')).to.include('samesite=lax')
      expect(findCookie(cookies, 'XSRF-TOKEN')).to.include('SameSite=Lax')
    })

    it('should set SameSite=None and Secure when cookieSameSite is none', async function() {
      await startAuthMock({cookieSameSite: 'none'})
      var res = await request({
        port: port
      , path: '/auth/mock/'
      , headers: {'x-forwarded-proto': 'https'}
      })
      var cookies = getCookies(res.headers)
      var ssidCookie = findCookie(cookies, 'ssid')
      var sigCookie = findCookie(cookies, 'ssid.sig')
      var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')

      expect(ssidCookie).to.include('samesite=none')
      expect(ssidCookie).to.include('secure')
      expect(sigCookie).to.include('samesite=none')
      expect(sigCookie).to.include('secure')
      expect(xsrfCookie).to.include('SameSite=None')
      expect(xsrfCookie).to.include('Secure')
    })

    it('should allow iframe cross-site login when SameSite=None cookies sent', async function() {
      await startAuthMock({cookieSameSite: 'none'})

      var getRes = await request({
        port: port
      , path: '/auth/mock/'
      , headers: {'x-forwarded-proto': 'https'}
      })
      var cookies = getCookies(getRes.headers)
      var ssidCookie = findCookie(cookies, 'ssid')
      var sigCookie = findCookie(cookies, 'ssid.sig')
      var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')

      expect(ssidCookie).to.not.equal(null)
      expect(sigCookie).to.not.equal(null)
      expect(xsrfCookie).to.not.equal(null)

      var ssidVal = ssidCookie!.split(';')[0]
      var sigVal = sigCookie!.split(';')[0]
      var xsrfToken = xsrfCookie!.split(';')[0]!.split('=')[1]

      var loginBody = JSON.stringify({name: 'testuser', email: 'test@example.com'})
      var postRes = await request({
        port: port
      , path: '/auth/api/v1/mock'
      , method: 'POST'
      , headers: {
          'content-type': 'application/json'
        , 'x-forwarded-proto': 'https'
        , cookie: ssidVal + '; ' + sigVal
        , 'x-xsrf-token': xsrfToken
        }
      , body: loginBody
      })

      expect(postRes.statusCode).to.equal(200)
      var data = JSON.parse(postRes.body)
      expect(data.success).to.equal(true)
      expect(data.redirect).to.include('http://127.0.0.1:7105/')
    })

    it('should reject login with 403 invalid csrf token if cookie dropped', async function() {
      await startAuthMock({})

      var getRes = await request({port: port, path: '/auth/mock/'})
      var cookies = getCookies(getRes.headers)
      var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')
      var xsrfToken = xsrfCookie!.split(';')[0]!.split('=')[1]

      var loginBody = JSON.stringify({name: 'testuser', email: 'test@example.com'})
      var postRes = await request({
        port: port
      , path: '/auth/api/v1/mock'
      , method: 'POST'
      , headers: {
          'content-type': 'application/json'
        , 'x-xsrf-token': xsrfToken
        }
      , body: loginBody
      })

      expect(postRes.statusCode).to.equal(403)
      expect(postRes.body).to.include('invalid csrf token')
    })
  })

  describe('app unit cookie headers', function() {
    var appUnit: typeof AppUnit
      , existsStub: sinon.SinonStub
      , restoreDb: (() => void) | undefined
      , restoreAuth: (() => void) | undefined
    var server: http.Server | null = null
    var port = 0
    var token = jwtutil.encode({
      payload: {email: 'user@example.com', name: 'User'}
    , secret: 'test-secret'
    })

    before(async function() {
      existsStub = sinon.stub(fs, 'existsSync').callThrough()
      existsStub.withArgs(pathutil.resource('build')).returns(true)

      restoreDb = mockModule(new URL('../../lib/db/api.js', import.meta.url), {
        default: {
          saveUserAfterLogin: function() {
            return Promise.resolve({})
          }
        , loadUser: function() {
            return Promise.resolve({
              email: 'user@example.com'
            , name: 'User'
            , privilege: 'user'
            , settings: {}
            })
          }
        }
      })
      const freshAuth = await importFresh(
        new URL('../../lib/units/app/middleware/auth.js', import.meta.url)
      )
      restoreAuth = mockModule(
        new URL('../../lib/units/app/middleware/auth.js', import.meta.url)
      , freshAuth
      )
      appUnit = (await importFresh(
        new URL('../../lib/units/app/index.js', import.meta.url)
      )).default
    })

    after(function() {
      existsStub.restore()
      restoreAuth?.()
      restoreDb?.()
    })

    afterEach(function(done) {
      if (server) {
        server.close(function() {
          server = null
          done()
        })
      }
      else {
        done()
      }
    })

    function startApp(options: {
      cookieSameSite?: 'lax' | 'strict' | 'none'
      cookieSecure?: boolean
    }): Promise<number> {
      return new Promise(function(resolve) {
        var createServer = http.createServer
        var serverStub = sinon.stub(http, 'createServer').callsFake(function(...args: any[]) {
          server = createServer.apply(http, args as any)
          return server
        })

        try {
          appUnit({
            port: 0
          , secret: 'test-secret'
          , ssid: 'ssid'
          , authUrl: 'http://127.0.0.1:7120/'
          , websocketUrl: 'http://127.0.0.1:7110/'
          , cookieSameSite: options.cookieSameSite
          , cookieSecure: options.cookieSecure
          })
        }
        finally {
          serverStub.restore()
        }

        server!.once('listening', function() {
          port = (server!.address() as AddressInfo).port
          resolve(port)
        })
      })
    }

    it('should keep the legacy cookie attributes by default', async function() {
      await startApp({})
      var authRes = await request({port: port, path: '/?jwt=' + encodeURIComponent(token)})
      var authCookies = getCookies(authRes.headers)
      var ssidCookie = findCookie(authCookies, 'ssid')

      expect(ssidCookie).to.not.include('samesite')
      expect(ssidCookie).to.not.include('secure')

      var cookieHeader = authCookies.map((c) => c.split(';')[0]).join('; ')
      var appRes = await request({
        port: port
      , path: '/app/api/v1/user'
      , headers: {cookie: cookieHeader}
      })
      var xsrfCookie = findCookie(getCookies(appRes.headers), 'XSRF-TOKEN')
      expect(xsrfCookie).to.not.include('SameSite')
      expect(xsrfCookie).to.not.include('Secure')
    })

    it('should set SameSite=None and Secure behind X-Forwarded-Proto https', async function() {
      await startApp({cookieSameSite: 'none'})
      var authRes = await request({
        port: port
      , path: '/?jwt=' + encodeURIComponent(token)
      , headers: {'x-forwarded-proto': 'https'}
      })
      var authCookies = getCookies(authRes.headers)
      var ssidCookie = findCookie(authCookies, 'ssid')

      expect(ssidCookie).to.include('samesite=none')
      expect(ssidCookie).to.include('secure')

      var cookieHeader = authCookies.map((c) => c.split(';')[0]).join('; ')
      var appRes = await request({
        port: port
      , path: '/app/api/v1/user'
      , headers: {cookie: cookieHeader, 'x-forwarded-proto': 'https'}
      })
      var xsrfCookie = findCookie(getCookies(appRes.headers), 'XSRF-TOKEN')
      expect(xsrfCookie).to.include('SameSite=None')
      expect(xsrfCookie).to.include('Secure')
    })
  })
})
