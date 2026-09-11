module.exports =
  function StandaloneServiceFactory($window, $rootScope, SettingsService,
    ScalingService, GroupService, $timeout) {
    var service = {}

    var screenWidth = $window.screen.availWidth || $window.screen.width || 1024
    var screenHeight = $window.screen.availHeight || $window.screen.height ||
      768
    var windowSizeRatio = 0.5
    var geometrySetting = 'standaloneWindowGeometry'
    var sizeTolerance = 1

    function fitDeviceInBounds(device, boundsWidth, boundsHeight, rotation) {
      var scaler = ScalingService.coordinator(
        device.display.width, device.display.height
      )

      return scaler.projectedSize(boundsWidth, boundsHeight, rotation)
    }

    function fitDeviceInGuestScreen(device) {
      // console.log('device.width', device.width)
      // console.log('device', device)

      return fitDeviceInBounds(
        device
        , screenWidth * windowSizeRatio
        , screenHeight * windowSizeRatio
        , device.display.rotation
      )
    }

    function defaultGeometry(device) {
      var projected = fitDeviceInGuestScreen(device)

      return {
        width: projected.width
        , height: projected.height
        , top: screenHeight / 4
        , left: screenWidth / 5
      }
    }

    function savedGeometry(device) {
      var geometries = SettingsService.get(geometrySetting)

      return geometries && geometries[device.serial]
    }

    function saveGeometry(device, geometry) {
      var geometries = {}
      geometries[device.serial] = geometry
      SettingsService.set(geometrySetting, geometries)
    }


    service.open = function(device) {
      var url = '#!/c/' + (device.serial ? device.serial : '') + '?standalone'

      var geometry = savedGeometry(device) || defaultGeometry(device)

      var features = [
        'width=' + geometry.width
        , 'height=' + geometry.height
        , 'top=' + geometry.top
        , 'left=' + geometry.left
        , 'toolbar=no'
        , 'location=no'
        , 'dialog=yes'
        , 'personalbar=no'
        , 'directories=no'
        , 'status=no'
        , 'menubar=no'
        , 'scrollbars=no'
        , 'copyhistory=no'
        , 'resizable=yes'
      ].join(',')

      var newWindow = $window.open(url, 'STF-' + device.serial, features)

      function setWindowTitle(newWindow, device) {
        var windowTitle = 'STF - ' + device.name
        if (device.name !== device.model) {
          windowTitle += ' (' + device.model + ')'
        }
        // windowTitle += ' (' + device.serial + ')'

        if (newWindow.document) {
          newWindow.document.title = windowTitle
        }

        $timeout(function() {
          if (newWindow.document) {
            newWindow.document.title = windowTitle
          }
        }, 400)
      }

      setWindowTitle(newWindow, device)


      newWindow.onbeforeunload = function() {
        // TODO: check for usage
        GroupService.kick(device).then(function() {
          $rootScope.$digest()
        })

        saveGeometry(device, {
          width: newWindow.innerWidth
          , height: newWindow.innerHeight
          , top: newWindow.screenTop
          , left: newWindow.screenLeft
        })
      }

      newWindow.onresize = function() {
        var fitted = fitDeviceInBounds(
          device, newWindow.outerWidth, newWindow.outerHeight, 0
        )

        if (Math.abs(fitted.width - newWindow.outerWidth) > sizeTolerance ||
          Math.abs(fitted.height - newWindow.outerHeight) > sizeTolerance) {
          newWindow.resizeTo(fitted.width, fitted.height)
        }
      }
    }


    return service
  }
