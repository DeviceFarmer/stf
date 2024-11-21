/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function MenuCtrl(
  $scope
, $rootScope
, UsersService
, AppState
, SettingsService
, $location
, $http
, CommonService
, LogcatService
, socket
, $cookies
, $window) {

  $window.angular.version = {}
  $window.d3.version = {}

  SettingsService.bind($scope, {
    target: 'lastUsedDevice'
  })

  SettingsService.bind($rootScope, {
    target: 'platform',
    defaultValue: 'native',
    deviceEntries: LogcatService.deviceEntries
  })

  $scope.$on('$routeChangeSuccess', function() {
    $scope.isControlRoute = $location.path().search('/control') !== -1
  })

  $scope.mailToSupport = function() {
    CommonService.url('mailto:' + $scope.contactEmail)
  }

  $http.get('/auth/contact').then(function(response) {
    $scope.contactEmail = response.data.contact.email
  })

  $scope.logout = function() {
    const cookies = $cookies.getAll()
    for (const key in cookies) {
      if (cookies.hasOwnProperty(key)) {
        $cookies.remove(key, {path: '/'})
      }
    }
    $window.location = '/'
    setTimeout(function() {
      socket.disconnect()
    }, 100)
  }

  $scope.alertMessage = {
    activation: 'False'
  , data: ''
  , level: ''
  }

  if (AppState.user.privilege === 'admin') {
    $scope.alertMessage = SettingsService.get('alertMessage')
  }
  else {
    UsersService.getUsersAlertMessage().then(function(response) {
      $scope.alertMessage = response.data.alertMessage
    })
  }

  $scope.isAlertMessageActive = function() {
    return $scope.alertMessage.activation === 'True'
  }

  $scope.isInformationAlert = function() {
    return $scope.alertMessage.level === 'Information'
  }

  $scope.isWarningAlert = function() {
    return $scope.alertMessage.level === 'Warning'
  }

  $scope.isCriticalAlert = function() {
    return $scope.alertMessage.level === 'Critical'
  }

  $scope.$on('user.menu.users.updated', function(event, message) {
    if (message.user.privilege === 'admin') {
      $scope.alertMessage = message.user.settings.alertMessage
    }
  })
}
