describe('addAdbKey', function() {
  beforeEach(angular.mock.module(require('./index').name))

  // the directive controller injects UserService, which lives in the app module
  beforeEach(angular.mock.module(function($provide) {
    $provide.value('UserService', {addAdbKey: jasmine.createSpy('addAdbKey')})
  }))

  var scope, compile, element

  beforeEach(inject(function($rootScope, $compile) {
    scope = $rootScope.$new()
    scope.showAdd = true
    scope.showClipboard = true
    compile = $compile
  }))

  afterEach(function() {
    if (element) {
      element.remove()
      element = null
    }
  })

  function build() {
    element = compile('<add-adb-key show-add="showAdd" show-clipboard="showClipboard"/>')(scope)
    scope.$digest()
    return element.isolateScope()
  }

  it('should publish the form on the isolate scope once the template has linked', function() {
    expect(build().adbkeyform).toBeDefined()
  })

  it('should make the form pristine again when the panel is closed', function() {
    var isolate = build()
    isolate.adbkeyform.$setDirty()

    isolate.closeAddKey()

    expect(isolate.adbkeyform.$pristine).toBe(true)
    expect(isolate.adbkeyform.$dirty).toBe(false)
  })

  it('should clear the submitted flag when the panel closes', function() {
    var isolate = build()
    isolate.adbkeyform.$setSubmitted()

    isolate.closeAddKey()

    expect(isolate.adbkeyform.$submitted).toBe(false)
  })

  it('should reset the form when the key list reports an update', function() {
    var isolate = build()
    isolate.adbkeyform.$setDirty()

    scope.$broadcast('user.keys.adb.updated')

    expect(isolate.adbkeyform.$pristine).toBe(true)
  })

  it('should still clear the fields, hide the panel and drop the error', function() {
    var isolate = build()
    isolate.addForm.title = 'laptop'
    isolate.addForm.key = 'ssh-rsa AAAAB3'
    isolate.error = 'nope'

    isolate.closeAddKey()
    scope.$digest()

    expect(isolate.addForm.title).toBe('')
    expect(isolate.addForm.key).toBe('')
    expect(isolate.error).toBe('')
    expect(scope.showAdd).toBe(false)
  })
})
