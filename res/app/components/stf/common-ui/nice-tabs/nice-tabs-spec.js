describe('niceTabs', function() {
  beforeEach(angular.mock.module(require('./').name))

  it('should ...', function() {

    /*
     To test your directive, you need to create some html that would use your directive,
     send that through compile() then compare the results.

     var element = compile('<div nice-tabs name="name">hi</div>')(scope);
     expect(element.text()).toBe('hello, world');
     */

  })

  it('should not register a singular niceTab directive', inject(function($injector) {
    expect($injector.has('niceTabDirective')).toBe(false)
  }))

  it('should register the niceTabs directive', inject(function($injector) {
    expect($injector.has('niceTabsDirective')).toBe(true)
  }))
})
