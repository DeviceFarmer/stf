//
// Count how many of the karma specs actually assert something.
//
// karma reports "82 specs, 0 failed", which reads as coverage it does not have:
// most of res/app's specs are the unmodified AngularJS generator stub, whose
// whole body is a comment, and a third are `expect(1).toEqual(1)`. Reporting the
// executed count alone overstates the tier, and hardcoding the real number would
// drift, so count it.
//
// usage: node count-assertions.js [dir...]      (default res/app)
//

var fs = require('fs')
var path = require('path')

// A tautology asserts a literal against itself: expect(1).toEqual(1),
// expect(true).toBe(true). It runs, it passes, it proves nothing.
var TAUTOLOGY =
  /^expect\(\s*(-?[\d.]+|true|false|'[^']*'|"[^"]*")\s*\)\s*\.\s*\w+\(\s*\1\s*\)$/

function specFiles(dir, found) {
  found = found || []
  fs.readdirSync(dir, {withFileTypes: true}).forEach(function(entry) {
    var full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      specFiles(full, found)
    }
    else if (/-spec\.js$/.test(entry.name)) {
      found.push(full)
    }
  })
  return found
}

// Strip comments and string bodies so neither a commented-out expect() nor one
// mentioned inside a string counts as an assertion. Keeps newlines so the
// remaining offsets still line up well enough for brace matching.
function strip(source) {
  var out = ''
  var i = 0
  var state = 'code'
  var quote = ''

  while (i < source.length) {
    var c = source[i]
    var next = source[i + 1]

    if (state === 'code') {
      if (c === '/' && next === '*') {
        state = 'block'
        i += 2
        continue
      }
      if (c === '/' && next === '/') {
        state = 'line'
        i += 2
        continue
      }
      if (c === '\'' || c === '"' || c === '`') {
        state = 'string'
        quote = c
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        i += 2
        continue
      }
      out += (c === '\n' ? '\n' : '')
      i++
      continue
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += '\n'
      }
      i++
      continue
    }

    // state === 'string'
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === quote) {
      state = 'code'
      out += c
    }
    else if (c === '\n') {
      out += '\n'
    }
    i++
  }

  return out
}

// Body of the it(...) call that starts at `from`, by paren depth.
function callBody(source, from) {
  var depth = 0
  var i = source.indexOf('(', from)
  if (i < 0) {
    return ''
  }
  var start = i
  for (; i < source.length; i++) {
    if (source[i] === '(') {
      depth++
    }
    else if (source[i] === ')') {
      depth--
      if (depth === 0) {
        return source.substring(start + 1, i)
      }
    }
  }
  return source.substring(start + 1)
}

function count(dirs) {
  var totals = {files: 0, specs: 0, asserting: 0, tautology: 0, empty: 0}

  dirs.forEach(function(dir) {
    specFiles(dir).forEach(function(file) {
      totals.files++
      var source = strip(fs.readFileSync(file, 'utf8'))
      var re = /\bit\s*\(/g
      var m

      while ((m = re.exec(source)) !== null) {
        var body = callBody(source, m.index)
        totals.specs++

        var expects = body.match(/\bexpect\s*\([\s\S]*?\)\s*\.\s*\w+\([\s\S]*?\)/g) || []
        if (!expects.length) {
          totals.empty++
          continue
        }
        var real = expects.filter(function(e) {
          return !TAUTOLOGY.test(e.replace(/\s+/g, ' ').trim())
        })
        if (real.length) {
          totals.asserting++
        }
        else {
          totals.tautology++
        }
      }
    })
  })

  return totals
}

function main() {
  var dirs = process.argv.slice(2)
  if (!dirs.length) {
    dirs = ['res/app']
  }
  var t = count(dirs)

  // "3 assert, 79 are stubs" is the honest short form for a report line.
  var stubs = t.tautology + t.empty
  process.stdout.write(JSON.stringify({
    files: t.files
  , specs: t.specs
  , asserting: t.asserting
  , tautology: t.tautology
  , empty: t.empty
  , stubs: stubs
  , summary: t.asserting + ' assert, ' + stubs + ' are upstream stubs'
  }) + '\n')
}

if (require.main === module) {
  main()
}

module.exports = {count: count, strip: strip, callBody: callBody}
