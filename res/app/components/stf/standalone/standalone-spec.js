describe('StandaloneService', function() {
  beforeEach(angular.mock.module(require('./').name))

  var service, popup, openSpy

  var deviceA = {
    serial: 'serial-a'
    , name: 'Device A'
    , model: 'Model A'
    , display: {
      width: 1080, height: 1920, rotation: 0
    }
  }

  var deviceB = {
    serial: 'serial-b'
    , name: 'Device B'
    , model: 'Model B'
    , display: {
      width: 800, height: 1280, rotation: 0
    }
  }

  var rotatedDevice = {
    serial: 'serial-rotated'
    , name: 'Device R'
    , model: 'Model R'
    , display: {
      width: 1080, height: 1920, rotation: 90
    }
  }

  beforeEach(angular.mock.module(function($provide) {
    $provide.value('GroupService', {
      kick: function() {
        return {then: angular.noop}
      }
    })
  }))

  beforeEach(inject(function(StandaloneService, $window) {
    service = StandaloneService

    popup = {
      document: {}
      , innerWidth: 0
      , innerHeight: 0
      , outerWidth: 0
      , outerHeight: 0
      , screenTop: 0
      , screenLeft: 0
      , resizeTo: jasmine.createSpy('resizeTo')
    }

    openSpy = spyOn($window, 'open').and.returnValue(popup)
  }))

  function geometryFeatures() {
    return openSpy.calls.mostRecent().args[2].split(',').slice(0, 4)
  }

  function closeAt(width, height, left, top) {
    popup.innerWidth = width
    popup.innerHeight = height
    popup.screenLeft = left
    popup.screenTop = top
    popup.onbeforeunload()
  }

  it('should open a new window at the aspect ratio of the device', function() {
    service.open(deviceA)

    var features = geometryFeatures()
    var width = Number(features[0].split('=')[1])
    var height = Number(features[1].split('=')[1])

    expect(width / height).toBeCloseTo(1080 / 1920, 2)
  })

  it('should reopen the window with the geometry it was closed at', function() {
    service.open(deviceA)
    closeAt(400, 700, 40, 30)

    service.open(deviceA)

    expect(geometryFeatures()).toEqual([
      'width=400', 'height=700', 'top=30', 'left=40'
    ])
  })

  it('should remember the geometry of each device separately', function() {
    service.open(deviceB)
    var untouchedFeatures = geometryFeatures()

    service.open(deviceA)
    closeAt(400, 700, 40, 30)

    service.open(deviceB)
    expect(geometryFeatures()).toEqual(untouchedFeatures)

    service.open(deviceA)
    expect(geometryFeatures()).toEqual([
      'width=400', 'height=700', 'top=30', 'left=40'
    ])
  })

  it('should refit a resized window to the aspect ratio of the device', function() {
    service.open(deviceA)

    popup.outerWidth = 600
    popup.outerHeight = 400
    popup.onresize()

    expect(popup.resizeTo).toHaveBeenCalledWith(225, 400)
  })

  it('should leave a resized window that already fits the device', function() {
    service.open(deviceA)

    popup.outerWidth = 281
    popup.outerHeight = 500
    popup.onresize()

    expect(popup.resizeTo).not.toHaveBeenCalled()
  })

  it('should leave a resized window of a rotated device that fits', function() {
    service.open(rotatedDevice)

    popup.outerWidth = 450
    popup.outerHeight = 800
    popup.onresize()

    expect(popup.resizeTo).not.toHaveBeenCalled()
  })
})
