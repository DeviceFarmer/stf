describe('InstallCtrl', function() {
  beforeEach(angular.mock.module(require('ui-bootstrap').name))
  beforeEach(angular.mock.module(require('./').name))

  var scope, compile, templates, element, ctrlScope, uninstalled

  beforeEach(inject(function($rootScope, $compile, $templateCache) {
    scope = $rootScope.$new()
    compile = $compile
    templates = $templateCache
    uninstalled = []
    scope.control = {
      uninstall: function(packageName) {
        uninstalled.push(packageName)
        return {then: function() {}}
      }
    }
  }))

  afterEach(function() {
    if (element) {
      element.remove()
      element = null
    }
  })

  function installed() {
    return {
      state: 'installed'
      , settled: true
      , success: true
      , progress: 100
      , manifest: {
        package: 'com.example.app'
        , application: {activities: []}
      }
    }
  }

  // the widget root carries ng-controller, so installation lives on its child scope
  function build(installation) {
    element = compile(
      templates.get('control-panes/dashboard/install/install.pug'))(scope)
    document.body.appendChild(element[0])
    scope.$digest()
    ctrlScope = element.scope()
    ctrlScope.installation = installation
    ctrlScope.$digest()

    // accordion-group pulls its template through $templateRequest, so it lands a digest later
    ctrlScope.$digest()
    return element[0]
  }

  function uninstallButton() {
    return element[0].querySelector('button[ng-click^="uninstall"]')
  }

  function heading() {
    return element[0].querySelector('.accordion-toggle')
  }

  // ng-if gives the accordion its own child scope, so accordionOpen written back
  // through is-open lands there and not on the controller's. The group's own
  // isolate scope is the one that says whether the panel is open.
  function group() {
    return angular.element(element[0].querySelector('.panel')).isolateScope()
  }

  function setOpen(value) {
    group().isOpen = value
    ctrlScope.$digest()
  }

  it('should offer an uninstall button once an app is installed', function() {
    build(installed())

    expect(uninstallButton()).not.toBeNull()
  })

  it('should uninstall the installed package when the button is clicked', function() {
    build(installed())

    uninstallButton().click()

    expect(uninstalled).toEqual(['com.example.app'])
  })

  // the button is transcluded into the group's own ng-click='toggleOpen()' anchor
  it('should leave a collapsed accordion alone when uninstall is clicked', function() {
    build(installed())
    setOpen(false)

    uninstallButton().click()

    expect(group().isOpen).toBe(false)
  })

  it('should leave an open accordion alone when uninstall is clicked', function() {
    build(installed())
    setOpen(true)

    uninstallButton().click()

    expect(group().isOpen).toBe(true)
  })

  it('should still toggle when the heading itself is clicked', function() {
    build(installed())
    setOpen(false)

    heading().click()

    expect(group().isOpen).toBe(true)
  })

  it('should drop the installation and collapse the accordion on clear', function() {
    build(installed())

    ctrlScope.clear()

    expect(ctrlScope.installation).toBeNull()
    expect(ctrlScope.accordionOpen).toBe(false)
  })
})
