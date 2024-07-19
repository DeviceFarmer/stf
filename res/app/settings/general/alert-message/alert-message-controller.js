/**
* Copyright © 2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function AlertMessageCtrl(
  $scope
, SettingsService
) {

  $scope.defaultAlertMessage = {
    data: '*** This site is currently under maintenance, please wait ***'
  , activation: 'False'
  , level: 'Critical'
  }

  SettingsService.bind($scope, {
    target: 'alertMessage'
  , source: 'alertMessage'
  , defaultValue: $scope.defaultAlertMessage
  })

  $scope.alertMessageActivationOptions = ['True', 'False']
  $scope.alertMessageLevelOptions = ['Information', 'Warning', 'Critical']

  $scope.$watch(
    function() {
      return SettingsService.get('alertMessage')
    }
  , function(newvalue) {
      if (typeof newvalue === 'undefined') {
        SettingsService.set('alertMessage', $scope.defaultAlertMessage)
      }
    }
  )

  $scope.$on('user.menu.users.updated', function(event, message) {
    if (message.user.privilege === 'admin') {
      $scope.alertMessage = message.user.settings.alertMessage
    }
  })
}
