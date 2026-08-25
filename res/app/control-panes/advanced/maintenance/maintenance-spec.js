describe('MaintenanceCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope

  beforeEach(inject(function($rootScope, $controller) {
    scope = $rootScope.$new()
    $controller('MaintenanceCtrl', {$scope: scope})
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
