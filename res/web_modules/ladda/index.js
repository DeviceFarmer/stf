require('ladda/dist/ladda-themeless.min.css')

// ladda.min.js is UMD, so under webpack it exports rather than setting window.Ladda
module.exports = require('ladda/dist/ladda.min.js')
