var url = require('url')

module.exports.addParams = function(originalUrl, params) {
  var parsed = url.parse(originalUrl, true)
  parsed.search = null
  Object.assign(parsed.query, params)
  return url.format(parsed)
}

module.exports.removeParam = function(originalUrl, param) {
  var parsed = url.parse(originalUrl, true)
  parsed.search = null
  delete parsed.query[param]
  return url.format(parsed)
}
