describe('FsCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope

  beforeEach(inject(function($rootScope, $controller, $q) {
    scope = $rootScope.$new()
    // ExplorerCtrl lists the device root on construction, which in the app
    // comes from the parent control pane.
    scope.control = {
      fslist: function() {
        return $q.resolve({body: []})
      }
    }
    $controller('ExplorerCtrl', {$scope: scope})
  }))

  it('should ...', inject(function() {
    expect(1).toEqual(1)
  }))
})
