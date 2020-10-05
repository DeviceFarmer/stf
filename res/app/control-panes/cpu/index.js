require('./cpu.css')

module.exports = angular.module('stf.cpu', [])
  .run( function($templateCache) {
    "ngInject";
    $templateCache.put('control-panes/cpu/cpu.pug',
      require('./cpu.pug')
    )
  })
  .controller('CpuCtrl', require('./cpu-controller'))
