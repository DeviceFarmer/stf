describe('NavigationCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope

  beforeEach(inject(function($rootScope, $controller) {
    scope = $rootScope.$new()
    $controller('NavigationCtrl', {$scope: scope})
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
