describe('LogsCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope

  beforeEach(inject(function($rootScope, $controller) {
    scope = $rootScope.$new()
    // The controller only reads $rootScope.LogcatService when the device list
    // has already published it, so leave it unset here.
    $controller('LogsCtrl', {
      $scope: scope
      // $routeParams comes from ngRoute, which the pane module does not pull
      // in on its own.
    , $routeParams: {serial: 'test-serial'}
    })
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
