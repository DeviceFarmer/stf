describe('ExternalUrlModalService', function() {
  var opened, dismissed, closed, service, controller, sce, scope

  beforeEach(angular.mock.module(require('./').name))

  beforeEach(angular.mock.module(function($provide) {
    $provide.value('$uibModal', {
      open: function(options) {
        opened = options
        return {
          result: {
            then: function() {}
          }
        }
      }
    })
  }))

  beforeEach(inject(function(
    ExternalUrlModalService, $controller, $rootScope, $sce) {
    service = ExternalUrlModalService
    controller = $controller
    sce = $sce
    scope = $rootScope.$new()
    opened = null
    dismissed = null
    closed = null
  }))

  function resolved(key) {
    return opened.resolve[key]()
  }

  function instance() {
    controller(opened.controller, {
      $scope: scope
      , $uibModalInstance: {
        close: function(value) {
          closed = value
        }
        , dismiss: function(reason) {
          dismissed = reason
        }
      }
      , url: resolved('url')
      , title: resolved('title')
      , icon: resolved('icon')
    })
    return scope
  }

  it('should hand the url, title and icon to the modal', function() {
    service.open('https://example.com/docs', 'Docs', 'fa-book')

    expect(resolved('url')).toEqual('https://example.com/docs')
    expect(resolved('title')).toEqual('Docs')
    expect(resolved('icon')).toEqual('fa-book')
  })

  // the template drops the url straight into an iframe src
  it('should trust the url so the iframe can load it', function() {
    service.open('https://example.com/docs', 'Docs', 'fa-book')

    expect(sce.getTrustedResourceUrl(instance().url))
      .toEqual('https://example.com/docs')
  })

  it('should close on ok and dismiss on cancel', function() {
    service.open('https://example.com/docs', 'Docs', 'fa-book')
    instance()

    scope.ok()
    expect(closed).toBe(true)

    scope.cancel()
    expect(dismissed).toEqual('cancel')
  })
})
