/**
* Copyright © 2024 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = angular.module('stf.settings.general.alert-message', [
  require('stf/settings').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put(
      'settings/general/alert-message/alert-message.pug'
    , require('./alert-message.pug')
    )
  }])
  .controller('AlertMessageCtrl', require('./alert-message-controller'))
