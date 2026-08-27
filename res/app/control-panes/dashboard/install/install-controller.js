module.exports = function InstallCtrl(
  $scope
, InstallService
) {
  $scope.accordionOpen = true
  $scope.installation = null

  $scope.clear = function() {
    $scope.installation = null
    $scope.accordionOpen = false
  }

  $scope.$on('installation', function(e, installation) {
    $scope.installation = installation.apply($scope)
  })

  $scope.installUrl = function(url) {
    return InstallService.installUrl($scope.control, url)
  }

  $scope.installFile = function($files) {
    if ($files.length) {
      return InstallService.installFile($scope.control, $files)
    }
    return null
  }

  $scope.uninstall = function(packageName, $event) {
    if ($event) {
      // the button is transcluded into the accordion heading's own anchor, which
      // both toggles the panel and, with an empty href, reloads the page
      $event.preventDefault()
      $event.stopPropagation()
    }

    return $scope.control.uninstall(packageName)
      .then(function() {
        $scope.$apply(function() {
          $scope.clear()
        })
      })
  }
}
