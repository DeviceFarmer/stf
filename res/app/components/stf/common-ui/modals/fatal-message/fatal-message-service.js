module.exports =
  function FatalMessageServiceFactory($uibModal, $location, $route, $interval,
    StateClassesService) {
    var FatalMessageService = {}

    var ModalInstanceCtrl = function($scope, $uibModalInstance, device,
      tryToReconnect) {
      var intervalReconnect

      $scope.ok = function() {
        $uibModalInstance.close(true)
        $route.reload()
      }

      function update() {
        $scope.device = device
        $scope.stateColor = StateClassesService.stateColor(device.state)
      }

      update()

      var intervalDeviceInfo = $interval(update, 750)

      if (tryToReconnect) {
        intervalReconnect = $interval(function() {
          update()

          if (device.usable) {
            // Try to reconnect
            $scope.ok()
          }
        }, 1000, 500)
      }

      $scope.second = function() {
        $uibModalInstance.dismiss()
        $location.path('/devices/')
      }

      $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel')
      }

      var destroyInterval = function() {
        if (intervalDeviceInfo) {
          $interval.cancel(intervalDeviceInfo)
          intervalDeviceInfo = null
        }

        if (intervalReconnect) {
          $interval.cancel(intervalReconnect)
          intervalReconnect = null
        }
      }

      $scope.$on('$destroy', function() {
        destroyInterval()
      })
    }

    FatalMessageService.open = function(device, tryToReconnect) {
      var modalInstance = $uibModal.open({
        template: require('./fatal-message.pug')
        , controller: ModalInstanceCtrl
        , resolve: {
          device: function() {
            return device
          }
          , tryToReconnect: function() {
            return tryToReconnect
          }
        }
      })

      modalInstance.result.then(function() {
      }, function() {

      })
    }


    return FatalMessageService
  }
