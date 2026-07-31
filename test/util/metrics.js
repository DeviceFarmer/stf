var chai = require('chai')
var expect = chai.expect

var apiutil = require('../../lib/util/apiutil')
var wire = require('../../lib/wire')
var metrics = require('../../lib/util/metrics')

function device(properties) {
  return Object.assign({
    serial: 'serial'
  , present: true
  , ready: true
  , status: wire.DeviceStatus.ONLINE
  , owner: null
  }, properties)
}

describe('Metrics', function() {
  describe('deviceState', function() {
    it('should report an unplugged device as absent whatever its other fields', function() {
      expect(metrics.deviceState(device({present: false}))).to.equal('absent')
      expect(metrics.deviceState(device({
        present: false
      , owner: {email: 'someone@example.org'}
      }))).to.equal('absent')
    })

    it('should report the adb status of a present device', function() {
      expect(metrics.deviceState(device({status: wire.DeviceStatus.OFFLINE})))
        .to.equal('offline')
      expect(metrics.deviceState(device({status: wire.DeviceStatus.UNAUTHORIZED})))
        .to.equal('unauthorized')
    })

    it('should report a not yet prepared online device as preparing', function() {
      expect(metrics.deviceState(device({ready: false}))).to.equal('preparing')
    })

    it('should report a ready online device as available or busy according to its owner',
      function() {
        expect(metrics.deviceState(device())).to.equal('available')
        expect(metrics.deviceState(device({owner: {email: 'someone@example.org'}})))
          .to.equal('busy')
      }
    )

    it('should report a device being connected or authorized as present', function() {
      expect(metrics.deviceState(device({status: wire.DeviceStatus.CONNECTING})))
        .to.equal('present')
      expect(metrics.deviceState(device({status: wire.DeviceStatus.AUTHORIZING})))
        .to.equal('present')
    })
  })

  describe('aggregateDevices', function() {
    it('should zero fill every known state so that no time serie ever disappears', function() {
      var stats = metrics.aggregateDevices([])

      expect(Object.keys(stats.byState).sort()).to.deep.equal(metrics.DEVICE_STATES.slice().sort())
      metrics.DEVICE_STATES.forEach(function(state) {
        expect(stats.byState[state]).to.equal(0)
      })
    })

    it('should count the devices per state', function() {
      var stats = metrics.aggregateDevices([
        device()
      , device({owner: {email: 'someone@example.org'}})
      , device({ready: false})
      , device({present: false})
      ])

      expect(stats.total).to.equal(4)
      expect(stats.available).to.equal(1)
      expect(stats.busy).to.equal(1)
      expect(stats.byState.available).to.equal(1)
      expect(stats.byState.busy).to.equal(1)
      expect(stats.byState.preparing).to.equal(1)
      expect(stats.byState.absent).to.equal(1)
    })

    it('should count the distinct providers of the present devices only', function() {
      var stats = metrics.aggregateDevices([
        device({provider: {name: 'provider1'}})
      , device({provider: {name: 'provider1'}})
      , device({provider: {name: 'provider2'}})
      , device({present: false, provider: {name: 'provider3'}})
      , device({provider: null})
      ])

      expect(stats.providers).to.equal(2)
    })
  })

  describe('aggregateUsers', function() {
    it('should count the users per privilege and ignore the unknown ones', function() {
      var stats = metrics.aggregateUsers([
        {privilege: apiutil.ADMIN}
      , {privilege: apiutil.USER}
      , {privilege: apiutil.USER}
      , {privilege: 'wat'}
      ])

      expect(stats.total).to.equal(4)
      expect(stats.byPrivilege[apiutil.ADMIN]).to.equal(1)
      expect(stats.byPrivilege[apiutil.USER]).to.equal(2)
      expect(stats.byPrivilege[apiutil.ROOT]).to.equal(0)
      expect(stats.byPrivilege.wat).to.be.an('undefined')
    })
  })

  describe('aggregateGroups', function() {
    it('should count the active groups using isActive and not the group state', function() {
      var stats = metrics.aggregateGroups([
        {isActive: true, state: apiutil.READY, class: apiutil.STANDARD}
      , {isActive: false, state: apiutil.READY, class: apiutil.ONCE}
      , {isActive: false, state: apiutil.PENDING, class: apiutil.ONCE}
      ])

      expect(stats.total).to.equal(3)
      expect(stats.active).to.equal(1)
      expect(stats.byState[apiutil.READY]).to.equal(2)
      expect(stats.byState[apiutil.PENDING]).to.equal(1)
      expect(stats.byState[apiutil.WAITING]).to.equal(0)
      expect(stats.byClass[apiutil.ONCE]).to.equal(2)
      expect(stats.byClass[apiutil.STANDARD]).to.equal(1)
    })
  })

  describe('update', function() {
    it('should expose the counters using the Prometheus text exposition format', function() {
      metrics.update([device(), device({present: false})], [{privilege: apiutil.ADMIN}], [])

      return metrics.register.metrics().then(function(body) {
        expect(body).to.contain('stf_devices_total{app="stf"} 2')
        expect(body).to.contain('stf_devices_available{app="stf"} 1')
        expect(body).to.contain('stf_users_total{app="stf"} 1')
        expect(body).to.contain('stf_groups_total{app="stf"} 0')
        expect(body).to.contain('stf_devices_by_state{state="absent",app="stf"} 1')
      })
    })

    it('should not leak the previous values of a label', function() {
      metrics.update([device({owner: {email: 'someone@example.org'}})], [], [])

      return metrics.register.metrics()
        .then(function(body) {
          expect(body).to.contain('stf_devices_by_state{state="busy",app="stf"} 1')
          metrics.update([], [], [])
          return metrics.register.metrics()
        })
        .then(function(body) {
          expect(body).to.contain('stf_devices_by_state{state="busy",app="stf"} 0')
        })
    })
  })
})
