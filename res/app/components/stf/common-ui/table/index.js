//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

require('./table.css')
require('script-loader!ng-table/dist/ng-table')

module.exports = angular.module('stf/common-ui/table', [
  'ngTable'
])
