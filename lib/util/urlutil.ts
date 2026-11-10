import url from 'url'

var addParams = function(originalUrl: string, params: Record<string, string>) {
  var parsed = url.parse(originalUrl, true)
  parsed.search = null
  Object.assign(parsed.query, params)
  return url.format(parsed)
}

var removeParam = function(originalUrl: string, param: string) {
  var parsed = url.parse(originalUrl, true)
  parsed.search = null
  delete parsed.query[param]
  return url.format(parsed)
}

// Collapses leading slashes/backslashes so a request path such as "//host" or
// "/\\host" can never be read by a browser as a protocol-relative URL when it
// is used as a redirect target.
var toLocalPath = function(requestUrl: string) {
  return '/' + requestUrl.replace(/^[/\\]+/, '')
}

export default {addParams, removeParam, toLocalPath}
