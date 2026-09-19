module.exports = function niceTabsDirective(SettingsService) {
  return {
    restrict: 'EA'
    , replace: true
    , template: require('./nice-tabs.pug')
    , link: function(scope, element, attrs) {
      if (attrs.direction === 'below') {
        element.addClass('tabs-below')
      }

      var key = attrs.key
      var tabs = []
      var wantedTitle = key ? SettingsService.get(key) : null
      var selectedTitle = null

      scope.tabFound = function(tab) {
        if (!tab.filters) {
          return true
        }
        var found = false

        angular.forEach(tab.filters, function(value) {
          if (value === scope.filter) {
            found = true
          }
        })
        return found
      }

      function findWantedTab() {
        var wanted = null

        angular.forEach(tabs, function(tab) {
          if (!wanted && tab.title === wantedTitle && scope.tabFound(tab)) {
            wanted = tab
          }
        })
        return wanted
      }

      function restoreSelection() {
        if (!wantedTitle) {
          return
        }
        var wanted = findWantedTab()
        if (!wanted) {
          return
        }

        angular.forEach(tabs, function(tab) {
          tab.active = tab === wanted
        })
        selectedTitle = wantedTitle
        wantedTitle = null
      }

      function activeTitle() {
        var title = null

        angular.forEach(tabs, function(tab) {
          if (!title && tab.active) {
            title = tab.title
          }
        })
        return title
      }

      scope.$watch(attrs.tabs, function(newValue) {
        scope.tabs = newValue
        tabs = newValue || []
        restoreSelection()
      })

      scope.$watch(attrs.filter, function(newValue) {
        scope.filter = newValue
        restoreSelection()
      })

      if (key) {
        scope.$watch(activeTitle, function(title) {
          if (!title) {
            return
          }
          if (!selectedTitle) {
            selectedTitle = title
            return
          }
          if (title !== selectedTitle) {
            selectedTitle = title
            wantedTitle = null
            SettingsService.set(key, title)
          }
        })
      }
    }
  }
}
