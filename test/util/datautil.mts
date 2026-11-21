import * as chai from 'chai'
var expect = chai.expect

import datautil from '../../lib/util/datautil.js'
import type deviceutil from '../../lib/util/deviceutil.js'

type Claim = {email: string, expiresAt: number}

describe('datautil', function() {
  describe('normalize', function() {
    var user: deviceutil.Viewer = {email: 'user@example.com', privilege: 'user'}

    function device(restoreOwner: Claim | null): datautil.Device & {ready: boolean} {
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

    it('should report a present device held by the viewer as used', function() {
      const held = {...device(null), owner: {email: user.email}}
      datautil.normalize(held, user)
      expect(held.owner).to.deep.equal({email: user.email})
      expect(held.using).to.be.true
    })

    // The owner is blanked for an absent device, and `using` must agree with it rather than with
    // the owner still stored on the row
    it('should not report an absent device as used by its stored owner', function() {
      const gone = {...device(null), present: false, owner: {email: user.email}}
      datautil.normalize(gone, user)
      expect(gone.owner).to.be.null
      expect(gone.using).to.be.false
    })

    it('should not report an absent owned device as used to an administrator', function() {
      const admin: deviceutil.Viewer = {email: 'admin@example.com', privilege: 'admin'}
      const gone = {...device(null), present: false, owner: {email: 'someone@example.com'}}
      datautil.normalize(gone, admin)
      expect(gone.owner).to.be.null
      expect(gone.using).to.be.false
    })

    it('should keep a managed release receipt internal', function() {
      const released = device(null)
      released.automationRelease = {email: 'runner@example.test', leaseId: 'lease-a'}
      released.pendingOwnerReleases = [{
        reservationId: 'a', email: 'runner@example.test', leaseId: 'lease-a'
      }]
      released.lastOwnerRelease = {
        email: 'runner@example.test', reservationId: 'a', leaseId: 'lease-a'
      }
      datautil.normalize(released, user)
      expect(released).to.not.have.property('automationRelease')
      expect(released).to.not.have.property('pendingOwnerReleases')
      expect(released).to.not.have.property('lastOwnerRelease')
    })
  })
})
