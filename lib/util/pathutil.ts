import path from 'path'
import fs from 'fs'
import util from 'util'

// Returns '' for anything that isn't a package name (a bare scope, a relative
// segment), so the lookup below never stops at an unrelated directory.
function getPackageName(target: string): string {
  var parts = target.split(/[/\\]+/).filter(Boolean)
  var first = parts[0]
  if (!first || first === '.' || first === '..') {
    return ''
  }
  if (first.startsWith('@')) {
    var second = parts[1]
    return second && second !== '.' && second !== '..' ? first + '/' + second : ''
  }
  return first
}

// Export
var root = function(target: string, from?: string) {
  var base = from || path.resolve(import.meta.dirname, '../..')
  return path.resolve(base, target)
}

// Export
var resource = function(target: string) {
  return path.resolve(import.meta.dirname, '../../res', target)
}

// Export
var nodeModule = function(target: string, from?: string) {
  var start = from ? path.resolve(from) : path.resolve(import.meta.dirname, '../..')
  var pkg = getPackageName(target)

  for (var dir = start; ; dir = path.dirname(dir)) {
    var candidate = path.join(dir, 'node_modules', target)
    // this resolver is synchronous by contract, callers use it at init time
    // eslint-disable-next-line no-sync
    if (fs.existsSync(candidate)) {
      return candidate
    }
    // The closest installed copy owns the path even when the file is missing,
    // so probing for an optional file never falls through to another version.
    // eslint-disable-next-line no-sync
    if (pkg && fs.existsSync(path.join(dir, 'node_modules', pkg, 'package.json'))) {
      return candidate
    }
    if (dir === path.dirname(dir)) {
      break
    }
  }

  return path.resolve(start, 'node_modules', target)
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
