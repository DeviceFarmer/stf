module.exports = angular.module('stf.socket', [
  require('stf/app-state').name
])
  .factory('socket', require('./socket-service'))
