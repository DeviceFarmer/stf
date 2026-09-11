describe('FatalMessageService', function() {
  var opened, service, controller, rootScope, interval

  beforeEach(angular.mock.module(require('./').name))

  beforeEach(angular.mock.module(function($provide) {
    $provide.value('$uibModal', {
      open: function(options) {
        opened = options
        return {
          result: {
            then: function() {}
          }
        }
      }
    })
    $provide.value('StateClassesService', {
      stateColor: function(state) {
        return 'state-' + state
      }
    })
  }))

  beforeEach(inject(function(
    FatalMessageService, $controller, $rootScope, $interval) {
    service = FatalMessageService
    controller = $controller
    rootScope = $rootScope
    interval = $interval
    opened = null
  }))

  function instance(device, tryToReconnect) {
    var scope = rootScope.$new()
    service.open(device, tryToReconnect)
    controller(opened.controller, {
      $scope: scope
      , $uibModalInstance: {
        close: function() {}
        , dismiss: function() {}
      }
      , device: opened.resolve.device()
      , tryToReconnect: opened.resolve.tryToReconnect()
    })
    return scope
  }

  it('should show the current device state', function() {
    var device = {state: 'offline', usable: false}
    var scope = instance(device, false)

    expect(scope.device).toBe(device)
    expect(scope.stateColor).toEqual('state-offline')

    device.state = 'present'
    interval.flush(800)

    expect(scope.stateColor).toEqual('state-present')
  })

  it('should stop polling a reconnecting modal once it is destroyed',
    function() {
      var device = {state: 'offline', usable: false}
      var scope = instance(device, true)

      scope.$destroy()
      device.state = 'present'
      interval.flush(3000)

      expect(scope.stateColor).toEqual('state-offline')
    })

  it('should give every modal its own interval', function() {
    var first = {state: 'offline', usable: false}
    var second = {state: 'unauthorized', usable: false}
    var firstScope = instance(first, false)
    var secondScope = instance(second, false)

    firstScope.$destroy()
    first.state = 'present'
    second.state = 'present'
    interval.flush(800)

    expect(firstScope.stateColor).toEqual('state-offline')
    expect(secondScope.stateColor).toEqual('state-present')
  })
})
