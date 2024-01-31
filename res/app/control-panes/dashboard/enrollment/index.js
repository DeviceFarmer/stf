require('./enrollment.css')

module.exports = angular.module('stf.enrollment', [
  require('stf/common-ui').name,
  require('gettext').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/dashboard/enrollment/enrollment.pug',
      require('./enrollment.pug')
    )
  }])
  .controller('EnrollmentCtrl', require('./enrollment-controller'))
