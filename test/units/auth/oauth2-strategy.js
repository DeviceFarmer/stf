var chai = require('chai')
var expect = chai.expect

var Strategy = require('../../../lib/units/auth/oauth2/strategy')

describe('auth-oauth2 strategy', function() {
  var options

  beforeEach(function() {
    options = {
      authorizationURL: 'https://auth.example.com/authorize'
    , tokenURL: 'https://auth.example.com/token'
    , userinfoURL: 'https://auth.example.com/userinfo'
    , clientID: 'client'
    , clientSecret: 'secret'
    , callbackURL: 'https://stf.example.com/auth/oauth/callback'
    }
  })

  function verify() {
    return null
  }

  it('should accept a complete set of options', function() {
    var strategy = new Strategy(options, verify)
    expect(strategy._userinfoURL).to.equal(options.userinfoURL)
  })

  it('should require a userinfoURL option', function() {
    delete options.userinfoURL
    expect(function() {
      return new Strategy(options, verify)
    }).to.throw(TypeError, 'OAuth2Strategy requires a userinfoURL option')
  })
})
