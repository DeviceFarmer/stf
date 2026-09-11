var chai = require('chai')
var expect = chai.expect

var ldap = require('ldapjs')

var ldaputil = require('../../lib/util/ldaputil')

describe('ldaputil', function() {
  describe('login', function() {
    var BASE = 'dc=example,dc=com'
    var ADMIN_DN = 'cn=admin,' + BASE
    var ALICE_DN = 'cn=alice,ou=people,' + BASE
    var GROUPS = ['cn=devs,' + BASE, 'cn=ops,' + BASE]

    var server
    var options
    var lastFilter

    function normalize(dn) {
      return dn.toString().replace(/, /g, ',')
    }

    beforeEach(function(done) {
      lastFilter = null
      server = ldap.createServer()

      server.bind(BASE, function(req, res, next) {
        var dn = normalize(req.dn)
        var accepted = (dn === ADMIN_DN && req.credentials === 'adminpw')
          || (dn === ALICE_DN && req.credentials === 'alicepw')

        if (!accepted) {
          return next(new ldap.InvalidCredentialsError())
        }

        res.end()
        return next()
      })

      server.search(BASE, function(req, res, next) {
        lastFilter = req.filter.toString()

        if (req.filter.matches({objectClass: 'person', cn: 'alice', uid: 'alice'})) {
          res.send({
            dn: ALICE_DN
          , attributes: {
              objectClass: ['person']
            , cn: 'alice'
            , mail: 'alice@example.com'
            , memberOf: GROUPS
            }
          })
        }

        res.end()
        return next()
      })

      server.listen(0, '127.0.0.1', function() {
        options = {
          url: 'ldap://127.0.0.1:' + server.server.address().port
        , timeout: 5000
        , bind: {dn: ADMIN_DN, credentials: 'adminpw'}
        , search: {
            dn: BASE
          , scope: 'sub'
          , objectClass: 'person'
          , field: 'cn'
          }
        , username: {field: 'cn'}
        }
        done()
      })
    })

    afterEach(function(done) {
      server.close(done)
    })

    it('should resolve the entry attributes when the user binds', function() {
      return ldaputil.login(options, 'alice', 'alicepw')
        .then(function(user) {
          expect(user.dn).to.equal(ALICE_DN)
          expect(user.cn).to.equal('alice')
          expect(user.mail).to.equal('alice@example.com')
          expect(user.objectClass).to.equal('person')
        })
    })

    it('should keep a multi valued attribute as an array', function() {
      return ldaputil.login(options, 'alice', 'alicepw')
        .then(function(user) {
          expect(user.memberOf).to.eql(GROUPS)
        })
    })

    it('should reject with InvalidCredentialsError on a wrong password', function() {
      return ldaputil.login(options, 'alice', 'wrongpw')
        .then(function() {
          throw new Error('should not have resolved')
        }
        , function(err) {
            expect(err).to.be.an.instanceof(ldaputil.InvalidCredentialsError)
            expect(err.user).to.equal('alice')
          })
    })

    it('should reject with InvalidCredentialsError when no entry matches', function() {
      return ldaputil.login(options, 'bob', 'alicepw')
        .then(function() {
          throw new Error('should not have resolved')
        }
        , function(err) {
            expect(err).to.be.an.instanceof(ldaputil.InvalidCredentialsError)
            expect(err.user).to.equal('bob')
          })
    })

    it('should add a configured search filter to the query', function() {
      options.search.filter = '(uid=alice)'

      return ldaputil.login(options, 'alice', 'alicepw')
        .then(function() {
          expect(lastFilter).to.equal('(&(objectClass=person)(cn=alice)(uid=alice))')
        })
    })
  })

  describe('email', function() {
    it('should prefer mail, then email, then userPrincipalName', function() {
      expect(ldaputil.email({
        mail: 'mail@example.com'
      , email: 'email@example.com'
      , userPrincipalName: 'upn@example.com'
      })).to.equal('mail@example.com')

      expect(ldaputil.email({
        email: 'email@example.com'
      , userPrincipalName: 'upn@example.com'
      })).to.equal('email@example.com')

      expect(ldaputil.email({userPrincipalName: 'upn@example.com'}))
        .to.equal('upn@example.com')
    })
  })
})
