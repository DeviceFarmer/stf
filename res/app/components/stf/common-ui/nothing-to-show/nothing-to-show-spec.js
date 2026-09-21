describe('nothingToShow', function() {
  beforeEach(angular.mock.module(require('./').name))

  var scope, compile

  beforeEach(inject(function($rootScope, $compile) {
    scope = $rootScope.$new()
    compile = $compile
  }))

  it('should render message and icon without [object Module]', function() {
    var element = compile(
      '<nothing-to-show message="No screenshots taken" icon="fa-camera"></nothing-to-show>'
    )(scope)
    scope.$digest()
    expect(element.text()).not.toContain('[object Module]')
    expect(element.find('p').text()).toBe('No screenshots taken')
    expect(element.find('i').hasClass('fa-camera')).toBe(true)
  })
})
