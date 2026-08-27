module.exports = function RemoteDebugCtrl($scope, gettext) {
  function startRemoteConnect() {
    $scope.control.startRemoteConnect().then(function(result) {
      var url = result.lastData
      $scope.$apply(function() {
        $scope.debugCommand = 'adb connect ' + url
      })
    })
  }

  var stopWaitingForControl = $scope.$watch('control', function(control) {
    if (control) {
      stopWaitingForControl()
      startRemoteConnect()
    }
  })

  $scope.$watch('platform', function(newValue) {
    if (newValue === 'native') {
      $scope.remoteDebugTooltip =
        gettext('Run the following on your command line to debug the device from your IDE')
    }
    else {
      $scope.remoteDebugTooltip =
        gettext('Run the following on your command line to debug the device from your Browser')
    }
  })
}
