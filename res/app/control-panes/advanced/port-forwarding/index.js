/**
* Copyright © 2023 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

require('./port-forwarding.css')

module.exports = angular.module('stf.port-forwarding', [
  require('stf/common-ui/table').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put(
      'control-panes/advanced/port-forwarding/port-forwarding.pug',
      require('./port-forwarding.pug')
    )
  }])
  .controller('PortForwardingCtrl', require('./port-forwarding-controller'))
