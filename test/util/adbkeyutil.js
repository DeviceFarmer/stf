var chai = require('chai')
var expect = chai.expect

var adb = require('../../lib/util/adbutil')()
var adbkeyutil = require('../../lib/util/adbkeyutil')

// A throwaway key made with `adb keygen`, public half only
var publicKey = [
  'QAAAANXRMrKDILQ8XqMCPt7EbpINby2Re6AH2+lS3PrXtiIUyChc0eTl8b6uNC+ADScpLHwXoZgCcGnLEGvYWsFPHe'
, 'kGa+qr+1o8QCXUbBuXa+2m676aEY9NR4TIcperNatvGwCuOiOsgvlaL26d2DHcR/GXzRTtjZjwHXgMlLrBgailt1bI'
, 'QBvyBgLl8XeRE2bTQnTod38HtCFNekAzsiVThUzkb4ScDAaciOH3ZPUEojj1aIFj9a902vEYVHgTo7kRr13YvZGWM/'
, '7JnXHESlrC2lBXC0HE4KF891b8CoegS3U7DuOcKADPHCjShR1wlShoJKksTpKoDTFecbOkrSW0j977cffQts8jssB6'
, 'eCuVWXaqEINUHYlIPtZZfYNjpJCXfiqt54GO52mPHnFeHpWxh6yCeAtfr5XgfG1dgzdV6k3ebKbeslnoslkatnQlY/'
, '6qJ7CMIx1ftJnEmXNUcCBXVBKdPwcPIk5MSDwX/IHmDfcQ+uORthaAS7XaZC2B5SM43DYPpKAgl9zuSr5NzrfBu2Hp'
, 'H4S26lvJOADiQH4qIykFKtO7Tezrl3MsnE9SbNU5Bsxb9oAdTNy3SaeJhO+Tk9PKeVoye6GvNJoFiARaQjc2/2R4B1'
, 'kC24pjjqkLF9lRxhEhfoc85arqnKjCVScNuxugkbXdA9OHP0d0BtDG5pf0bTxYdwEAAQA='
].join('') + ' test@stf'

describe('adbkeyutil', function() {
  describe('encodePublicKey', function() {
    it('should give back the exact key adbkit parsed', function() {
      return adb.util.parsePublicKey(publicKey).then(function(key) {
        expect(adbkeyutil.encodePublicKey(key)).to.equal(publicKey)
      })
    })

    it('should leave the comment out when the key has none', function() {
      return adb.util.parsePublicKey(publicKey).then(function(key) {
        key.comment = ''
        expect(adbkeyutil.encodePublicKey(key)).to.equal(publicKey.split(' ')[0])
      })
    })

    it('should refuse a key that does not hash to its fingerprint', function() {
      return adb.util.parsePublicKey(publicKey).then(function(key) {
        key.fingerprint = '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff'
        expect(function() {
          adbkeyutil.encodePublicKey(key)
        }).to.throw(/fingerprint/)
      })
    })
  })
})
