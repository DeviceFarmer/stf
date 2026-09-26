import http from 'node:http'
import type {AddressInfo} from 'node:net'

import * as chai from 'chai'
var expect = chai.expect

import type AuthMock from '../../../lib/units/auth/mock.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

type StatusCallback = (err: Error | null, code?: number) => void
type ChallengeCallback = (
  err: Error | null
, code?: number
, headers?: http.IncomingHttpHeaders
, body?: string
) => void

mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
  run: function() {
    return Promise.resolve({})
  }
}})

var authMock: typeof AuthMock =
  (await importFresh(new URL('../../../lib/units/auth/mock.js', import.meta.url))).default

describe('auth-mock', function() {
  describe('basic auth', function() {
    var USERNAME = 'alice'
    var PASSWORD = 's3cret'

    var server: http.Server, port: number

    function start(done: Mocha.Done) {
      var createServer: (app: http.RequestListener) => http.Server = http.createServer

      http.createServer = function(app: http.RequestListener) {
        server = createServer.call(http, app)
        return server
      } as typeof http.createServer

      try {
        authMock({
          port: 0
        , secret: 'test-secret'
        , ssid: 'test-ssid'
        , appUrl: 'http://127.0.0.1:7105/'
        , mock: {
            useBasicAuth: true
          , basicAuth: {
              username: USERNAME
            , password: PASSWORD
            }
          }
        })
      }
      finally {
        http.createServer = createServer as typeof http.createServer
      }

      server.once('listening', function() {
        port = (server.address() as AddressInfo).port
        done()
      })
    }

    function status(headers: http.OutgoingHttpHeaders | null, done: StatusCallback) {
      http.get({
        host: '127.0.0.1'
      , port: port
      , path: '/auth/mock/'
      , headers: headers || {}
      }, function(res) {
        res.resume()
        done(null, res.statusCode)
      }).on('error', done)
    }

    function challenge(done: ChallengeCallback) {
      http.get({
        host: '127.0.0.1'
      , port: port
      , path: '/auth/mock/'
      , headers: {}
      }, function(res) {
        var body = ''
        res.on('data', function(chunk) {
          body += chunk
        })
        res.on('end', function() {
          done(null, res.statusCode, res.headers, body)
        })
      }).on('error', done)
    }

    function basic(user: string, pass: string) {
      var raw = Buffer.from(user + ':' + pass).toString('base64')
      return {authorization: 'Basic ' + raw}
    }

    before(start)

    after(function(done) {
      server.close(function() {
        done()
      })
    })

    it('should let the right credentials through', function(done) {
      status(basic(USERNAME, PASSWORD), function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(200)
        return done()
      })
    })

    it('should reject a request with no credentials', function(done) {
      status(null, function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        return done()
      })
    })

    it('should reject the wrong password', function(done) {
      status(basic(USERNAME, 'nope'), function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        return done()
      })
    })

    it('should reject the wrong user', function(done) {
      status(basic('bob', PASSWORD), function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        return done()
      })
    })

    it('should reject a scheme that is not Basic', function(done) {
      status({authorization: 'Bearer xyz'}, function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        return done()
      })
    })

    it('should reject a Basic header that will not decode', function(done) {
      status({authorization: 'Basic !!!!'}, function(err, code) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        return done()
      })
    })

    it('should challenge with a 401 status and not a 401 body', function(done) {
      challenge(function(err, code, headers, body) {
        if (err) {
          return done(err)
        }
        expect(code).to.equal(401)
        expect(headers!['www-authenticate']).to.equal(
          'Basic realm=Authorization Required')
        expect(body).to.equal('Unauthorized')
        return done()
      })
    })
  })
})
