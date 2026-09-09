require('./docs.css')
require('angular-route')

module.exports = angular.module('stf.help.docs', [
  'ngRoute'
])
  .config(function($routeProvider) {
    function wikiUrl(document) {
      return '/static/wiki/[en]-' + document
    }

    $routeProvider
      .when('/docs/:document*', {
        templateUrl: function(params) {
          return wikiUrl(params.document.replace('.md', ''))
        }
      })
      .when('/help', {
        templateUrl: function() {
          return wikiUrl('Help')
        }
      })
  })
  .controller('DocsCtrl', require('./docs-controller'))
