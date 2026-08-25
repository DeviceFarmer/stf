module.exports =
  function landscapeDirective(BrowserInfo, $document, $window) {
    return {
      restrict: 'A'
      , link: function(scope) {
        var body = angular.element($document[0].body)

        function rotateGuest(portrait) {
          if (portrait) {
            body.addClass('guest-portrait')
            body.removeClass('guest-landscape')

            scope.$broadcast('guest-portrait')
          }
          else {
            body.addClass('guest-landscape')
            body.removeClass('guest-portrait')

            scope.$broadcast('guest-landscape')

            $window.scrollTo(0, 0)
          }
        }

        if (typeof $window.orientation !== 'undefined') {
          if ($window.orientation !== 0) {
            rotateGuest(false)
          }
        }

        function guestDisplayRotated() {
          var isPortrait = (window.innerHeight > window.innerWidth)
          rotateGuest(isPortrait)
        }

        if (BrowserInfo.deviceorientation) {
          window.addEventListener('orientationchange', guestDisplayRotated,
            true)
        }

        function off() {
          if (BrowserInfo.deviceorientation) {
            window.removeEventListener('orientationchange',
              guestDisplayRotated)
          }
        }

        scope.$on('$destroy', off)
      }
    }
  }
