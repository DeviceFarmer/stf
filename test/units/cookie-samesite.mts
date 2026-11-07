import http from 'node:http'
import fs from 'node:fs'
import type {AddressInfo} from 'node:net'

import * as chai from 'chai'
import sinon from 'sinon'
import yargs from 'yargs'

var expect = chai.expect

import jwtutil from '../../lib/util/jwtutil.js'
import * as appCli from '../../lib/cli/app/index.js'
import * as authMockCli from '../../lib/cli/auth-mock/index.js'
import * as localCli from '../../lib/cli/local/index.js'
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
  describe('CLI option parsing', function() {
    var originalEnv: NodeJS.ProcessEnv

    beforeEach(function() {
      originalEnv = {...process.env}
    })

    afterEach(function() {
      process.env = originalEnv
    })

    it('should default --cookie-same-site to lax for app and auth-mock', function() {
      var appParsed = parseCli(appCli, [
        'app', '--secret', 's3cret', '--auth-url', 'http://127.0.0.1:7120/'
      , '--websocket-url', 'http://127.0.0.1:7110/'
      ])
      var authParsed = parseCli(authMockCli, [
        'auth-mock', '--secret', 's3cret', '--app-url', 'http://127.0.0.1:7105/'
      ])
      var localParsed = parseCli(localCli, ['local'])

      expect(appParsed.cookieSameSite).to.equal('lax')
      expect(authParsed.cookieSameSite).to.equal('lax')
      expect(localParsed.cookieSameSite).to.equal('lax')
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
    })
  })

  describe('auth-mock cookie headers and CSRF verification', function() {
    var authMock: typeof AuthMock
    var server: http.Server | null = null
    var port = 0

    before(async function() {
      mockModule(new URL('../../lib/db/index.js', import.meta.url), {
        default: {
          run: function() {
            return Promise.resolve({})
          }
        }
      })
      mockModule(new URL('../../lib/db/api.js', import.meta.url), {
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
        var createServer: any = http.createServer
        http.createServer = function(...args: any[]) {
          server = createServer.apply(http, args)
          return server
        } as any

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
          http.createServer = createServer as typeof http.createServer
        }

        server!.once('listening', function() {
          port = (server!.address() as AddressInfo).port
          resolve(port)
        })
      })
    }

    it('should set SameSite=Lax without Secure over plain HTTP by default', async function() {
      await startAuthMock({})
      var res = await request({port: port, path: '/auth/mock/'})
      var cookies = getCookies(res.headers)
      var ssidCookie = findCookie(cookies, 'ssid')
      var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')

      expect(ssidCookie).to.include('samesite=lax')
      expect(ssidCookie).to.not.include('secure')
      expect(xsrfCookie).to.include('SameSite=Lax')
      expect(xsrfCookie).to.not.include('Secure')
    })

    it('should set SameSite=Lax and Secure behind X-Forwarded-Proto https', async function() {
      await startAuthMock({})
      var res = await request({
        port: port
      , path: '/auth/mock/'
      , headers: {'x-forwarded-proto': 'https'}
      })
      var cookies = getCookies(res.headers)
      var ssidCookie = findCookie(cookies, 'ssid')
      var xsrfCookie = findCookie(cookies, 'XSRF-TOKEN')

      expect(ssidCookie).to.include('samesite=lax')
      expect(ssidCookie).to.include('secure')
      expect(xsrfCookie).to.include('SameSite=Lax')
      expect(xsrfCookie).to.include('Secure')
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
    var server: http.Server | null = null
    var port = 0
    var token = jwtutil.encode({
      payload: {email: 'user@example.com', name: 'User'}
    , secret: 'test-secret'
    })

    before(async function() {
      existsStub = sinon.stub(fs, 'existsSync').returns(true)
      mockModule(new URL('../../lib/db/api.js', import.meta.url), {
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
      mockModule(new URL('../../lib/units/app/middleware/auth.js', import.meta.url), freshAuth)
      appUnit = (await importFresh(
        new URL('../../lib/units/app/index.js', import.meta.url)
      )).default
    })

    after(function() {
      existsStub.restore()
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
        var createServer: any = http.createServer
        http.createServer = function(...args: any[]) {
          server = createServer.apply(http, args)
          return server
        } as any

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
          http.createServer = createServer as typeof http.createServer
        }

        server!.once('listening', function() {
          port = (server!.address() as AddressInfo).port
          resolve(port)
        })
      })
    }

    it('should set SameSite=Lax without Secure over plain HTTP by default', async function() {
      await startApp({})
      var authRes = await request({port: port, path: '/?jwt=' + encodeURIComponent(token)})
      var authCookies = getCookies(authRes.headers)
      var ssidCookie = findCookie(authCookies, 'ssid')

      expect(ssidCookie).to.include('samesite=lax')
      expect(ssidCookie).to.not.include('secure')

      var cookieHeader = authCookies.map((c) => c.split(';')[0]).join('; ')
      var appRes = await request({
        port: port
      , path: '/app/api/v1/user'
      , headers: {cookie: cookieHeader}
      })
      var xsrfCookie = findCookie(getCookies(appRes.headers), 'XSRF-TOKEN')
      expect(xsrfCookie).to.include('SameSite=Lax')
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
