require('nine-bootstrap')

require('./cursor.css')
require('./small.css')
require('./stf-styles.css')

var modFiles = [
  'stf/landscape',
  'stf/basic-mode',
  'ui-bootstrap',
  'angular-borderlayout',
  'stf/common-ui',
  'stf/socket/socket-state',
  'stf/common-ui/modals/socket-disconnected',
  'stf/browser-info'
];
var mods = [
  require('stf/landscape'),
  require('stf/basic-mode'),
  require('ui-bootstrap'),
  require('angular-borderlayout'),
  require('stf/common-ui'),
  require('stf/socket/socket-state'),
  require('stf/common-ui/modals/socket-disconnected'),
  require('stf/browser-info')
];

var modnames = [];
for( var i=0;i<modFiles.length;i++ ) {
  var modFile = modFiles[ i ];
  var mod = mods[ i ];
  if( !mod ) { console.log("Could not load mod " + modFile); continue; }
  if( !mod.name ) { console.log("Module " + modFile + " does not have a module name"); continue; }
  modnames.push( mod.name );
}  

module.exports = angular.module('layout', modnames)
  .config(['$uibTooltipProvider', function($uibTooltipProvider) {
    $uibTooltipProvider.options({
      appendToBody: true,
      animation: false
    })
  }])
  .controller('LayoutCtrl', require('./layout-controller'))
