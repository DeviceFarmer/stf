describe('MenuCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope, common

  beforeEach(inject(function($rootScope, $controller, CommonService) {
    scope = $rootScope.$new()
    common = CommonService
    $controller('MenuCtrl', {$scope: scope})
  }))

  it('should not depend on the removed stf.native-url module', function() {
    expect(angular.module(require('./').name).requires)
      .not.toContain('stf.native-url')
  })

  it('should not provide NativeUrlService', inject(function($injector) {
    expect($injector.has('NativeUrlService')).toBe(false)
  }))

  it('should open the support address through CommonService', function() {
    spyOn(common, 'url')
    scope.contactEmail = 'support@example.com'
    scope.mailToSupport()

    expect(common.url).toHaveBeenCalledWith('mailto:support@example.com')
  })
})
