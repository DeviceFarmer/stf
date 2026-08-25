describe('AccessTokensCtrl', function() {
  beforeEach(angular.mock.module(require('./index').name))

  var scope

  beforeEach(inject(function($rootScope, $controller) {
    scope = $rootScope.$new()
    $controller('AccessTokensCtrl', {$scope: scope})
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
