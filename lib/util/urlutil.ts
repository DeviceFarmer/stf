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

export default {addParams, removeParam}
