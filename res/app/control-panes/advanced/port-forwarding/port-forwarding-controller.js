/**
* Copyright © 2023 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var uuid = require('uuid')
var Promise = require('bluebird')

module.exports = function PortForwardingCtrl(
  $scope
) {
  function defaults(id) {
    return {
      id: id
    , targetHost: 'localhost'
    , targetPort: 8080
    , devicePort: 8080
    , enabled: false
    }
  }

  $scope.reversePortForwards = [defaults('_default')]

  $scope.$watch('device.reverseForwards', function(newValue) {
    let map = Object.create(null)

    if (newValue) {
      newValue.forEach(function(forward) {
        map[forward.id] = forward
      })

     $scope.reversePortForwards.forEach(function(forward) {
       let deviceForward = map[forward.id]

       if (deviceForward) {
         forward.enabled = !!(deviceForward.id === forward.id &&
           deviceForward.devicePort === Number(forward.devicePort))
       }
       else if (forward.enabled) {
         $scope.removeRow(forward)
       }
     })
    }
  })

  $scope.applyForward = function(forward) {
    return forward.enabled ?
      $scope.control.createForward(forward) :
      $scope.control.removeForward(forward)
  }

  $scope.enableForward = function(forward) {
    if (forward.enabled) {
      return Promise.resolve()
    }

    return $scope.control.createForward(forward)
  }

  $scope.disableForward = function(forward) {
    if (!forward.enabled) {
      return Promise.resolve()
    }

    return $scope.control.removeForward(forward)
  }

  $scope.addRow = function() {
    $scope.reversePortForwards.push(defaults(uuid.v4()))
  }

  $scope.removeRow = function(forward) {
    $scope.disableForward(forward)
    $scope.reversePortForwards.splice(
      $scope.reversePortForwards.indexOf(forward), 1)
  }
}
