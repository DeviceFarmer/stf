import path from 'path'
import fs from 'fs'
import util from 'util'

// Export
var root = function(target: string) {
  return path.resolve(import.meta.dirname, '../..', target)
}

// Export
var resource = function(target: string) {
  return path.resolve(import.meta.dirname, '../../res', target)
}

// Export
var nodeModule = function(target: string) {
  return path.resolve(import.meta.dirname, '../../node_modules', target)
}

// Export
var match = function(candidates: string[]) {
  for (var i = 0, l = candidates.length; i < l; ++i) {
    // this resolver is synchronous by contract, callers use it at init time
    // eslint-disable-next-line no-sync
    if (fs.existsSync(candidates[i]!)) {
      return candidates[i]!
    }
  }
  return null
}

// Export
var requiredMatch = function(candidates: string[]) {
  var matched = match(candidates)
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

export default {
  root: root
, resource: resource
, module: nodeModule
, match: match
, requiredMatch: requiredMatch
}
