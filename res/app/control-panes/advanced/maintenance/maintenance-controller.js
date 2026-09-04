module.exports = function($scope, gettext, $filter) {
  function confirmReboot(question, keepOwnership) {
    var config = {
      rebootEnabled: true
    }

    /* eslint no-console: 0 */
    if (config.rebootEnabled) {
      var line1 = $filter('translate')(question)
      var line2 = $filter('translate')(gettext('The device will be unavailable for a moment.'))
      // a native confirm is deliberate for a destructive action
      // eslint-disable-next-line no-alert
      if (confirm(line1 + '\n' + line2)) {
        var reboot = keepOwnership ? $scope.control.rebootAndKeep() : $scope.control.reboot()
        reboot.then(function(result) {
          console.error(result)
        })
      }
    }
  }

  $scope.reboot = function() {
    confirmReboot(gettext('Are you sure you want to reboot this device?'), false)
  }

  // Same reboot, except the device is held rather than released, so control is not lost over it
  $scope.rebootAndKeep = function() {
    confirmReboot(
      gettext('Are you sure you want to reboot this device and keep using it afterwards?')
    , true
    )
  }
}
