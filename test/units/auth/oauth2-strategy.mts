import * as chai from 'chai'
var expect = chai.expect

import Strategy from '../../../lib/units/auth/oauth2/strategy.js'

type StrategyOptions = ConstructorParameters<typeof Strategy>[0]

describe('auth-oauth2 strategy', function() {
  var options: Partial<StrategyOptions>

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
    var strategy = new Strategy(options as StrategyOptions, verify)
    expect(strategy._userinfoURL).to.equal(options.userinfoURL)
  })

  it('should require a userinfoURL option', function() {
    delete options.userinfoURL
    expect(function() {
      return new Strategy(options as StrategyOptions, verify)
    }).to.throw(TypeError, 'OAuth2Strategy requires a userinfoURL option')
  })
})
