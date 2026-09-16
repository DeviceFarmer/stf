describe('SettingsService', function() {
  beforeEach(angular.mock.module(require('./').name))

  var service, settings, emitted

  beforeEach(function() {
    settings = {}
    emitted = []
  })

  beforeEach(angular.mock.module(function($provide) {
    $provide.value('UserService', {
      currentUser: {
        get settings() {
          return settings
        }
      }
    })

    $provide.value('socket', {
      on: angular.noop
    , emit: function(name, delta) {
        emitted.push([name, delta])
      }
    })
  }))

  function load(initial) {
    settings = initial
    var injected
    inject(function(SettingsService) {
      injected = SettingsService
    })
    service = injected
  }

  it('should replace an array rather than merging it index by index', function() {
    load({deviceListSort: {user: [{name: 'a'}, {name: 'b'}]}})

    service.update({deviceListSort: {user: [{name: 'c'}]}})

    expect(service.get('deviceListSort').user).toEqual([{name: 'c'}])
  })

  it('should not leave a stale tail when an array shrinks', function() {
    load({columns: ['one', 'two', 'three']})

    service.update({columns: ['only']})

    expect(service.get('columns')).toEqual(['only'])
  })

  it('should still merge plain objects key by key', function() {
    load({tabs: {icons: true, details: false}})

    service.update({tabs: {details: true}})

    expect(service.get('tabs')).toEqual({icons: true, details: true})
  })

  it('should grow an array as well as shrink it', function() {
    load({columns: ['one']})

    service.update({columns: ['a', 'b', 'c']})

    expect(service.get('columns')).toEqual(['a', 'b', 'c'])
  })

  it('should leave settings the delta does not mention', function() {
    load({keep: 'me', columns: ['one', 'two']})

    service.update({columns: ['only']})

    expect(service.get('keep')).toEqual('me')
  })

  it('should send the delta to the server unchanged', function() {
    load({columns: ['one', 'two']})

    service.update({columns: ['only']})

    expect(emitted).toEqual([['user.settings.update', {columns: ['only']}]])
  })
})
