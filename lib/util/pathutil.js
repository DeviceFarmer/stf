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
module.exports.module = function(target) {
  return path.resolve(__dirname, '../../node_modules', target)
}

// Export
module.exports.match = function(candidates) {
  for (var i = 0, l = candidates.length; i < l; ++i) {
    // this resolver is synchronous by contract, callers use it at init time
    // eslint-disable-next-line no-sync
    if (fs.existsSync(candidates[i])) {
      return candidates[i]
    }
  }
  return null
}

// Export
module.exports.requiredMatch = function(candidates) {
  var matched = this.match(candidates)
  if (matched) {
    return matched
  }
  else {
    throw new Error(util.format(
      'At least one of these paths should exist: %s'
    , candidates.join(', ')
    ))
  }
}
