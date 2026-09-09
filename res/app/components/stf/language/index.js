module.exports = angular.module('stf-language', [
  require('stf/settings').name
  , require('gettext').name
])
  .factory('LanguageService', require('./language-service'))
