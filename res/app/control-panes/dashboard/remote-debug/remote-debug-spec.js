describe('RemoteDebugCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope, controller, timeout, settle

  beforeEach(inject(function($rootScope, $controller, $timeout) {
    scope = $rootScope.$new()
    timeout = $timeout
    settle = null
    controller = function() {
      $controller('RemoteDebugCtrl', {$scope: scope})
    }
  }))

  // the real control returns a socket promise, so it settles outside any digest
  function control(url) {
    return {
      startRemoteConnect: function() {
        return {
          then: function(callback) {
            settle = function() {
              callback({lastData: url})
            }
          }
        }
      }
    }
  }

  it('should ask for the connect url when control is there already', function() {
    scope.control = control('10.0.0.1:5555')

    controller()
    scope.$digest()
    settle()

    expect(scope.debugCommand).toEqual('adb connect 10.0.0.1:5555')
  })

  it('should wait for control rather than guessing when it will arrive', function() {
    controller()
    scope.$digest()

    expect(settle).toBeNull()

    scope.control = control('10.0.0.2:5555')
    scope.$digest()
    settle()

    expect(scope.debugCommand).toEqual('adb connect 10.0.0.2:5555')
  })

  // control can take longer to arrive than any fixed retry ladder allows for
  it('should still connect when control shows up late', function() {
    controller()
    scope.$digest()

    timeout.flush(5000)

    scope.control = control('10.0.0.3:5555')
    scope.$digest()
    settle()

    expect(scope.debugCommand).toEqual('adb connect 10.0.0.3:5555')
  })

  it('should not leave a timer pending when control never arrives', function() {
    controller()
    scope.$digest()

    expect(function() {
      timeout.verifyNoPendingTasks()
    }).not.toThrow()
  })

  it('should ask only once even if control is replaced later', function() {
    var calls = 0
    var counting = {
      startRemoteConnect: function() {
        calls++
        return {then: function() {}}
      }
    }

    controller()
    scope.control = counting
    scope.$digest()
    scope.control = angular.extend({}, counting)
    scope.$digest()

    expect(calls).toEqual(1)
  })

  it('should describe the command differently for native and browser', function() {
    controller()

    scope.platform = 'native'
    scope.$digest()
    expect(scope.remoteDebugTooltip).toMatch('from your IDE')

    scope.platform = 'browser'
    scope.$digest()
    expect(scope.remoteDebugTooltip).toMatch('from your Browser')
  })
})
