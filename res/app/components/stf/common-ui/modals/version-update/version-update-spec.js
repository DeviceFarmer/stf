describe('VersionUpdateService', function() {
  beforeEach(angular.mock.module(require('./').name))

  var service, modal, location

  beforeEach(inject(function(VersionUpdateService, $uibModal, $location) {
    service = VersionUpdateService
    modal = $uibModal
    location = $location
  }))

  // the modal controller is a plain function on the options object, so the spec
  // runs it directly instead of standing up a modal instance
  function openWith(instance) {
    var opened
    spyOn(modal, 'open').and.callFake(function(options) {
      opened = options
      return {result: {then: angular.noop}}
    })
    service.open()

    var scope = {}
    opened.controller(scope, instance)
    return scope
  }

  it('should open a modal', function() {
    openWith({})

    expect(modal.open).toHaveBeenCalled()
  })

  it('should send the user home when the modal is confirmed', function() {
    var instance = {close: jasmine.createSpy('close')}
    openWith(instance).ok()

    expect(instance.close).toHaveBeenCalledWith(true)
    expect(location.path()).toEqual('/')
  })

  it('should dismiss the modal when it is cancelled', function() {
    var instance = {dismiss: jasmine.createSpy('dismiss')}
    openWith(instance).cancel()

    expect(instance.dismiss).toHaveBeenCalledWith('cancel')
  })

  // the wiring used to live in the socket factory, which made stf.socket depend
  // on this modal
  it('should not be a dependency of stf.socket', function() {
    expect(angular.module(require('stf/socket').name).requires)
      .not.toContain(require('./').name)
  })
})
