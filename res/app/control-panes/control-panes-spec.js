var _ = require('lodash')

describe('ControlPanesCtrl', function() {
  beforeEach(angular.mock.module('ngRoute'))
  beforeEach(angular.mock.module(require('gettext').name))
  beforeEach(angular.mock.module(require('./').name))

  var rootScope, scope, instantiate, q, enhanceDevice, deviceDeferred, inviteDeferred
    , titleWrites

  beforeEach(inject(function($rootScope, $controller, $q, EnhanceDeviceService) {
    rootScope = $rootScope
    scope = $rootScope.$new()
    instantiate = $controller
    q = $q
    enhanceDevice = EnhanceDeviceService
    titleWrites = 0

    rootScope.$watch('pageTitle', function(newValue, oldValue) {
      if (newValue !== oldValue) {
        titleWrites++
      }
    })
  }))

  function enhancedDevice(overrides) {
    var device = _.merge({
      serial: 'CBFAKE0001'
      , channel: 'fakechannel'
      , present: true
      , status: 3
      , ready: true
      , platform: 'Android'
      , group: {owner: {email: 'group-owner@example.com'}}
    }, overrides)

    enhanceDevice.enhance(device)
    return device
  }

  function deviceChange(device, payload) {
    _.merge(device, payload)
    enhanceDevice.enhance(device)
    rootScope.$digest()
  }

  function start(serial) {
    deviceDeferred = q.defer()
    inviteDeferred = q.defer()

    instantiate('ControlPanesCtrl', {
      $scope: scope
      , $routeParams: {serial: serial}
      , DeviceService: {
          get: function() {
            return deviceDeferred.promise
          }
        }
      , GroupService: {
          invite: function() {
            return inviteDeferred.promise
          }
        }
      , ControlService: {
          create: function() {
            return {}
          }
        }
      , SettingsService: {set: angular.noop, get: angular.noop}
      , StorageService: {}
      , FatalMessageService: {open: angular.noop}
    })
  }

  function resolveWith(device) {
    deviceDeferred.resolve(device)
    rootScope.$digest()
    inviteDeferred.resolve(device)
    rootScope.$digest()
  }

  it('should take the page title from the resolved device', function() {
    var device = enhancedDevice({name: 'Nexus 5', model: 'Nexus5', marketName: 'Nexus 5'})

    start(device.serial)
    resolveWith(device)

    expect(rootScope.pageTitle).toEqual('Nexus 5')
  })

  it('should write the page title once whatever the device does afterwards', function() {
    var device = enhancedDevice({name: 'Nexus 5', model: 'Nexus5', marketName: 'Nexus 5'})

    start(device.serial)
    resolveWith(device)

    deviceChange(device, {marketName: 'Nexus 5 LTE'})
    deviceChange(device, {battery: {level: 50, scale: 100}})
    deviceChange(device, {marketName: 'Nexus 5 LTE (Hammerhead)'})

    expect(device.enhancedName).toEqual('Nexus 5 LTE (Hammerhead)')
    expect(rootScope.pageTitle).toEqual('Nexus 5')
    expect(titleWrites).toBe(1)
  })

  it('should keep the page title still across plain digests', function() {
    var device = enhancedDevice({name: 'Nexus 5', model: 'Nexus5', marketName: 'Nexus 5'})

    start(device.serial)
    resolveWith(device)

    rootScope.$digest()
    rootScope.$digest()
    rootScope.$digest()

    expect(titleWrites).toBe(1)
  })

  it('should not put undefined in the page title of a device with no name', function() {
    var device = enhancedDevice({model: 'SM-G930F'})

    start(device.serial)
    resolveWith(device)

    expect(device.name).toBeUndefined()
    expect(rootScope.pageTitle).toEqual('SM-G930F')
    expect(rootScope.pageTitle).not.toEqual('undefined')
  })

  it('should fall back to the serial of a device the device database misses', function() {
    var device = enhancedDevice({})

    start(device.serial)
    resolveWith(device)

    expect(rootScope.pageTitle).toEqual('CBFAKE0001')
  })

  it('should restore the plain title when the pane goes away', function() {
    var device = enhancedDevice({name: 'Nexus 5', model: 'Nexus5', marketName: 'Nexus 5'})

    start(device.serial)
    resolveWith(device)
    expect(rootScope.pageTitle).toEqual('Nexus 5')

    scope.$destroy()

    expect(rootScope.pageTitle).toBeFalsy()
  })

  it('should not title a pane the user left before the device arrived', function() {
    var device = enhancedDevice({name: 'Nexus 5', model: 'Nexus5', marketName: 'Nexus 5'})

    start(device.serial)
    scope.$destroy()
    resolveWith(device)

    expect(rootScope.pageTitle).toBeFalsy()
  })
})
