var path = require('path')
var fs = require('fs')
var util = require('util')

// Export
module.exports.root = function(target) {
  return path.resolve(__dirname, '../..', target)
}

// Export
module.exports.resource = function(target) {
  return path.resolve(__dirname, '../../res', target)
}

// Export
module.exports.vendor = function(target) {
  return path.resolve(__dirname, '../../vendor', target)
}

// Export
module.exports.module = function(target) {
  // Uses require.resolve to lookup module relative targets.
  // For alternative package managers like yarn, pnpm, .nvm, etc. this is more reliable than computing paths in node_modules

  // require.resolve will reject requests for paths that are not modules (i.e not javascript or JSON)
  // We get around this by first looking up the package.json of the containing package and then
  // computing the full module path relative to package.json

  const parts = target.split('/')

  const packageNameLength = target.startsWith('@') ? 2 : 1
  const packageName = parts.slice(0, packageNameLength).join('/')
  const moduleName = parts.slice(packageNameLength).join('/')

  const packageJSONPath = require.resolve(path.posix.join(packageName, 'package.json'))
  const result = path.join(packageJSONPath, '..', moduleName)

  return result
}

// Export
module.exports.match = function(candidates) {
  for (var i = 0, l = candidates.length; i < l; ++i) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i]
    }
  }
  return undefined
}

// Export
module.exports.requiredMatch = function(candidates) {
  var matched = this.match(candidates)
  if(matched !== undefined) {
    return matched
  }
  else {
    throw new Error(util.format(
      'At least one of these paths should exist: %s'
    , candidates.join(', ')
    ))
  }
}
