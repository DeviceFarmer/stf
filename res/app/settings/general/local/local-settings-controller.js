module.exports = function($scope, SettingsService) {
  $scope.resetSettings = function() {
    SettingsService.reset()
    // eslint-disable-next-line no-alert
    alert('Settings cleared')
  }
}
