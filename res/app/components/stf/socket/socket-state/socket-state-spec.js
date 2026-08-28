describe('socketState', function() {
  // the directive injects gettext, which the module has always left to app.js
  beforeEach(angular.mock.module(require('gettext').name))
  beforeEach(angular.mock.module(require('./').name))

  var socket, versionUpdate, element

  beforeEach(inject(function($compile, $rootScope, _socket_, VersionUpdateService) {
    socket = _socket_
    versionUpdate = VersionUpdateService
    element = $compile('<socket-state></socket-state>')($rootScope.$new())
    $rootScope.$digest()
  }))

  afterEach(function() {
    element.remove()
  })

  // being in the directive's socketListeners map is also what gets outdated the
  // same beforeunload cleanup the other socket events already had
  it('should listen for outdated alongside the other socket states', function() {
    expect(socket.listeners('outdated').length).toEqual(1)
    expect(socket.listeners('disconnect').length).toEqual(1)
  })

  it('should open the version update modal when the client is outdated', function() {
    spyOn(versionUpdate, 'open')
    socket.listeners('outdated')[0]()

    expect(versionUpdate.open).toHaveBeenCalled()
  })
})
