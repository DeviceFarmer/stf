module.exports = function DeviceSettingsCtrl($scope, $timeout) {
  $scope.wifiEnabled = true
  $scope.bluetoothEnabled = true
  $scope.bluetoothPending = false

  function getWifiStatus() {
    if ($scope.control) {
      $scope.control.getWifiStatus().then(function(result) {
        $scope.$apply(function() {
          $scope.wifiEnabled = (result.lastData === 'wifi_enabled')
        })
      })
    }
  }
  getWifiStatus()

  $scope.toggleWifi = function(enable) {
    if ($scope.control) {
      $scope.control.setWifiEnabled(enable)
      $timeout(getWifiStatus, 2500)
    }
  }

  function getBluetoothStatus() {
    if ($scope.control) {
      $scope.bluetoothPending = true
      $scope.control.getBluetoothStatus()
        .then(function(result) {
          $scope.$apply(function() {
            $scope.bluetoothEnabled = (result.lastData === 'bluetooth_enabled')
          })
      })
      .finally(function() {
        $scope.bluetoothPending = false
      })
    }
  }
  getBluetoothStatus()

  $scope.toggleBluetooth = function(enable) {
    if ($scope.control) {
      $scope.bluetoothPending = true
      $scope.control.setBluetoothEnabled(enable)
        .then(function() {
          $scope.bluetoothEnabled = enable
        })
        .finally(function() {
          $scope.bluetoothPending = false
        })
    }
  }

  $scope.$watch('ringerMode', function(newValue, oldValue) {
    if (oldValue) {
      if ($scope.control) {
        $scope.control.setRingerMode(newValue)
      }
    }
  })

  function getRingerMode() {
    if ($scope.control) {
      $scope.control.getRingerMode().then(function(result) {
        $scope.$apply(function() {
          $scope.ringerMode = result.body
        })
      })
    }
  }
  getRingerMode()

}
