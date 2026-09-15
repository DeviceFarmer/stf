var http = require('http')

var chai = require('chai')
var expect = chai.expect

var dbPath = require.resolve('../../../lib/db')

require.cache[dbPath] = {exports: {
  run: function() {
    return Promise.resolve({})
  }
}}

var authMock = require('../../../lib/units/auth/mock')

describe('auth-mock', function() {
  describe('basic auth', function() {
    var USERNAME = 'alice'
    var PASSWORD = 's3cret'

    var server
    var port

    function start(done) {
      var createServer = http.createServer

      http.createServer = function(app) {
        server = createServer.call(http, app)
        return server
      }

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
        http.createServer = createServer
      }

      server.once('listening', function() {
        port = server.address().port
        done()
      })
    }

    function status(headers, done) {
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

    function basic(user, pass) {
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
  })
})
