describe('StoreAccountCtrl', function() {
  beforeEach(angular.mock.module(require('./').name))
  beforeEach(angular.mock.module(require('gettext').name))

  var scope, compile, catalog, template, element, ctrlScope

  beforeEach(inject(function($rootScope, $compile, $templateCache, gettextCatalog) {
    scope = $rootScope.$new()
    compile = $compile
    catalog = gettextCatalog
    template = $templateCache.get(
      'control-panes/automation/store-account/store-account.pug')
  }))

  afterEach(function() {
    if (element) {
      element.remove()
      element = null
    }
  })

  // the widget root carries ng-controller, so addingAccount lives on its child scope
  function build() {
    element = compile(template)(scope)
    document.body.appendChild(element[0])
    scope.$digest()
    ctrlScope = element.scope()
    return element[0].querySelector('button[ng-click="addAccount()"]')
  }

  function setAdding(value) {
    ctrlScope.addingAccount = value
    ctrlScope.$digest()
  }

  it('should turn the sign in button into a ladda button', function() {
    expect(build().className).toMatch('ladda-button')
  })

  it('should keep the translated label inside the ladda wrapper', function() {
    var label = build().querySelector('.ladda-label')

    expect(label).not.toBeNull()
    expect(label.textContent).toMatch('Sign In')
  })

  it('should spin while an account is being added', function() {
    var button = build()

    setAdding(true)

    expect(button.getAttribute('data-loading')).not.toBeNull()
    expect(button.querySelector('.ladda-spinner')).not.toBeNull()
  })

  it('should stop spinning and keep its label once the add settles', function() {
    var button = build()

    setAdding(true)
    setAdding(false)

    expect(button.getAttribute('data-loading')).toBeNull()
    expect(button.querySelector('.ladda-label').textContent).toMatch('Sign In')
  })

  // the old comment blamed gettext for ladda being switched off
  it('should retranslate the label without losing the ladda wrapper', function() {
    var button = build()

    catalog.setStrings('fr', {'Sign In': 'Se connecter'})
    catalog.setCurrentLanguage('fr')
    ctrlScope.$digest()

    expect(button.className).toMatch('ladda-button')
    expect(button.querySelector('.ladda-label').textContent).toMatch('Se connecter')
    expect(button.querySelector('.ladda-spinner')).not.toBeNull()
  })
})
