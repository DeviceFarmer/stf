describe('stf-language', function() {
  beforeEach(angular.mock.module(require('./').name))

  it('should not register a language provider', inject(function($injector) {
    expect($injector.has('language')).toBe(false)
  }))

  it('should still build LanguageService without app-state', inject(
    function(LanguageService) {
      expect(LanguageService.settingKey).toEqual('selectedLanguage')
      expect(LanguageService.defaultLanguage).toEqual('en')
    }))
})
