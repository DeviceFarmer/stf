var chai = require('chai')
var expect = chai.expect

var deviceutil = require('../../lib/util/deviceutil')

describe('deviceutil', function() {
  describe('isAddable', function() {
    function free(extra) {
      return Object.assign({present: true, ready: true, using: false, owner: null}, extra)
    }

    it('should allow a device that is present, ready and unowned', function() {
      expect(deviceutil.isAddable(free())).to.be.true
    })

    // The window between a device becoming ready and its held owner being put back: the row says
    // ready and unowned, and without this anyone polling could take it out from under them
    it('should refuse a device that is being held for someone', function() {
      expect(deviceutil.isAddable(free({claimed: true}))).to.be.false
    })

    it('should refuse a device that is absent, not ready, in use or owned', function() {
      expect(deviceutil.isAddable(free({present: false}))).to.be.false
      expect(deviceutil.isAddable(free({ready: false}))).to.be.false
      expect(deviceutil.isAddable(free({using: true}))).to.be.false
      expect(deviceutil.isAddable(free({owner: {email: 'someone@example.com'}}))).to.be.false
    })
  })

  // What datautil reports to readers as `claimed`, and what the processor checks before it reads
  // the users table. Anything it lets through is still subject to the group check in isRestorable.
  describe('isClaimLive', function() {
    var NOW = 1000

    function device(extra) {
      return Object.assign({
        owner: null
      , group: {id: 'group1'}
      , restoreOwner: {email: 'user@example.com', usage: null, expiresAt: NOW + 1}
      }, extra)
    }

    it('should hold a device whose claim has not expired', function() {
      expect(deviceutil.isClaimLive(device(), NOW)).to.be.true
    })

    // The claim is only ever settled when a device next goes ready, so a device that never comes
    // back would otherwise stay unaddable for good rather than for the length of the claim
    it('should stop holding a device once the claim expires', function() {
      expect(deviceutil.isClaimLive(device(), NOW + 1)).to.be.false
      expect(deviceutil.isClaimLive(device(), NOW + 100000)).to.be.false
    })

    it('should refuse a claim with no readable expiry rather than hold the device for ever',
      function() {
        expect(deviceutil.isClaimLive(device({restoreOwner: {email: 'user@example.com'}}), NOW))
          .to.be.false
      })

    it('should refuse a device that is unclaimed, already owned, or out of its group', function() {
      expect(deviceutil.isClaimLive(device({restoreOwner: null}), NOW)).to.be.false
      expect(deviceutil.isClaimLive(device({owner: {email: 'other@example.com'}}), NOW)).to.be.false
      expect(deviceutil.isClaimLive(device({group: null}), NOW)).to.be.false
    })

    it('should refuse a missing device', function() {
      expect(deviceutil.isClaimLive(null, NOW)).to.be.false
    })
  })

  describe('isRestorable', function() {
    var NOW = 1000
    var claim = {email: 'user@example.com', usage: null, expiresAt: NOW + 1}

    function device(extra) {
      return Object.assign({
        owner: null
      , group: {id: 'group1'}
      , restoreOwner: claim
      }, extra)
    }

    function user(groups) {
      return {
        email: 'user@example.com'
      , name: 'User'
      , group: 'channel1'
      , groups: {subscribed: groups}
      }
    }

    it('should restore a claim whose user may still use the device', function() {
      expect(deviceutil.isRestorable(device(), user(['group1']), NOW)).to.be.true
    })

    it('should not restore a claim that has expired', function() {
      expect(deviceutil.isRestorable(device(), user(['group1']), NOW + 1)).to.be.false
    })

    // Guards the negated expiry comparison: `expiresAt <= now` would let these through
    it('should not restore a claim with no expiry', function() {
      expect(deviceutil.isRestorable(device({restoreOwner: {email: claim.email}}), user(['group1'])
      , NOW)).to.be.false
    })

    it('should not restore a device nobody claimed', function() {
      expect(deviceutil.isRestorable(device({restoreOwner: null}), user(['group1']), NOW))
        .to.be.false
    })

    it('should not restore a claim whose user no longer exists', function() {
      expect(deviceutil.isRestorable(device(), null, NOW)).to.be.false
    })

    // The device can be moved between groups, or the user unsubscribed, while it is away
    it('should not restore a claim whose user lost access to the group', function() {
      expect(deviceutil.isRestorable(device(), user(['group2']), NOW)).to.be.false
    })

    it('should not restore a device that someone else took in the meantime', function() {
      var taken = device({owner: {email: 'other@example.com'}})
      expect(deviceutil.isRestorable(taken, user(['group1']), NOW)).to.be.false
    })

    it('should not restore a device that has no group', function() {
      expect(deviceutil.isRestorable(device({group: null}), user(['group1']), NOW)).to.be.false
    })

    // A user record from before groups were recorded, rather than one subscribed to nothing
    it('should not restore when the user has no subscriptions recorded', function() {
      expect(deviceutil.isRestorable(device(), {email: 'user@example.com'}, NOW)).to.be.false
    })
  })
})
