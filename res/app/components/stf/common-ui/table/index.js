require('./table.css')
require('script-loader!ng-table/dist/ng-table')

module.exports = angular.module('stf/common-ui/table', [
  'ngTable'
])
