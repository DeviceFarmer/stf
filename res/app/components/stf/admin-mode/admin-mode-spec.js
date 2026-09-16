describe('AdminModeService', function() {
  beforeEach(angular.mock.module(require('./').name))

  beforeEach(angular.mock.module(function($provide) {
    $provide.value('SettingsService', {bind: jasmine.createSpy('bind')})
  }))

  it('should bind admin mode to the root scope with a disabled default',
    inject(function($compile, $rootScope, SettingsService) {
      var element = $compile('<div admin-mode></div>')($rootScope)

      expect(SettingsService.bind).toHaveBeenCalledWith($rootScope, {
        target: 'adminMode'
      , defaultValue: false
      })
      element.remove()
    })
  )
})
