describe('stf.help.docs', function() {
  beforeEach(angular.mock.module(require('./').name))

  var routes
  beforeEach(inject(function($route) {
    routes = $route.routes
  }))

  it('should point /help at the English Help page', function() {
    expect(routes['/help'].templateUrl()).toEqual('/static/wiki/[en]-Help')
  })

  it('should point a document route at its English page', function() {
    expect(routes['/docs/:document*'].templateUrl({document: 'ADB-Keys'}))
      .toEqual('/static/wiki/[en]-ADB-Keys')
  })

  it('should strip a .md suffix off the document name', function() {
    expect(routes['/docs/:document*'].templateUrl({document: 'ADB-Keys.md'}))
      .toEqual('/static/wiki/[en]-ADB-Keys')
  })

  // the routes used to read languageProvider.$get() and drop the result on the
  // next line, which is the only thing that pulled a provider into this config
  it('should build its routes without any language dependency', function() {
    expect(angular.module(require('./').name).requires)
      .not.toContain(require('stf/language').name)
  })
})
