var chai = require('chai')
var expect = chai.expect

var datautil = require('../../lib/util/datautil')

describe('datautil', function() {
  describe('normalize', function() {
    var user = {email: 'user@example.com', privilege: 'user'}

    function device(restoreOwner) {
      return {
        present: true
      , ready: true
      , group: {id: 'group1'}
      , owner: null
      , restoreOwner: restoreOwner
      }
    }

    // normalize enriches rather than whitelists and every device response goes through it, so a
    // claim naming a user would otherwise be handed to anyone who can see the device
    it('should never let the held-for user leave the server', function() {
      var held = device({email: 'someone@example.com', expiresAt: Date.now() + 60000})
      datautil.normalize(held, user)
      expect(held).to.not.have.property('restoreOwner')
      expect(held.claimed).to.be.true
    })

    // isAddable reads `claimed`, and the expiry is judged nowhere else on that path, so an expired
    // claim left reading as held would keep a device untakeable until it next became ready
    it('should stop reporting a device as held once the claim expires', function() {
      var stale = device({email: 'someone@example.com', expiresAt: Date.now() - 1})
      datautil.normalize(stale, user)
      expect(stale.claimed).to.be.false
      expect(stale).to.not.have.property('restoreOwner')
    })

    it('should report an unclaimed device as not held', function() {
      var free = device(null)
      datautil.normalize(free, user)
      expect(free.claimed).to.be.false
    })
  })
})
