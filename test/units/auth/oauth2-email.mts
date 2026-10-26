import * as chai from 'chai'
var expect = chai.expect

import {isEmailAllowed, isEmailInDomain} from '../../../lib/units/auth/oauth2/email.js'

describe('auth-oauth2 email check', function() {
  describe('isEmailInDomain', function() {
    it('should accept addresses in the domain', function() {
      expect(isEmailInDomain('user@example.org', 'example.org')).to.equal(true)
    })

    it('should accept the domain written with a leading @', function() {
      expect(isEmailInDomain('user@example.org', '@example.org')).to.equal(true)
    })

    it('should accept subdomains', function() {
      expect(isEmailInDomain('user@team.example.org', 'example.org')).to.equal(true)
    })

    it('should ignore case', function() {
      expect(isEmailInDomain('User@Example.ORG', 'example.org')).to.equal(true)
    })

    it('should reject domains that only end with the same letters', function() {
      expect(isEmailInDomain('user@notexample.org', 'example.org')).to.equal(false)
      expect(isEmailInDomain('user@notexample.org', '@example.org')).to.equal(false)
    })

    it('should only look at the part after the last @', function() {
      expect(isEmailInDomain('example.org@attacker.test', 'example.org')).to.equal(false)
      expect(isEmailInDomain('user@example.org.attacker.test', 'example.org')).to.equal(false)
    })

    it('should reject addresses without a domain', function() {
      expect(isEmailInDomain('example.org', 'example.org')).to.equal(false)
    })
  })

  describe('isEmailAllowed', function() {
    it('should allow any address when no domain is configured', function() {
      expect(isEmailAllowed({email: 'user@anywhere.test'})).to.equal(true)
    })

    it('should reject a profile without an email', function() {
      expect(isEmailAllowed({}, 'example.org')).to.equal(false)
    })

    it('should reject an email the provider reports as unverified', function() {
      var unverified = {email: 'user@example.org', email_verified: false}
      expect(isEmailAllowed(unverified, 'example.org')).to.equal(false)
      expect(isEmailAllowed({...unverified, email_verified: 'false'})).to.equal(false)
    })

    it('should accept a verified email in the domain', function() {
      var verified = {email: 'user@example.org', email_verified: true}
      expect(isEmailAllowed(verified, 'example.org')).to.equal(true)
    })
  })
})
