//
// Turn a Playwright JSON report into a {check: pass|fail|skip} map.
//
// Test titles tag themselves with [check:<key>]; a key passes only if every
// test carrying it passed.
//
// usage: node playwright-checks.js <report.json> [out.json]
//

var fs = require('fs')
var layers = require('./checks')

// The verdict `extra` object, in the shape verdict.sh merges into verdict.json.
function reportOutputs(summary) {
  if (!process.env.GITHUB_OUTPUT) {
    return
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT
  , 'extra=' + JSON.stringify({
      checks: summary.checks
    , playwright_total: summary.total
    , playwright_failed: summary.failed.length
    }) + '\n')
}

function walk(node, specs) {
  if (!node) {
    return specs
  }
  if (Array.isArray(node.specs)) {
    node.specs.forEach(function(spec) {
      specs.push(spec)
    })
  }
  if (Array.isArray(node.suites)) {
    node.suites.forEach(function(child) {
      walk(child, specs)
    })
  }
  return specs
}

function specStatus(spec) {
  var tests = spec.tests || []
  if (!tests.length) {
    return 'skip'
  }
  var statuses = tests.map(function(t) {
    // Playwright reports the retried outcome in `status`; fall back to the
    // last result when a test never got a verdict.
    if (t.status) {
      return t.status
    }
    var results = t.results || []
    return results.length ? results[results.length - 1].status : 'skipped'
  })

  if (statuses.some(function(s) {
    return s === 'unexpected' || s === 'failed' || s === 'timedOut' ||
      s === 'interrupted'
  })) {
    return 'fail'
  }
  if (statuses.every(function(s) {
    return s === 'skipped'
  })) {
    return 'skip'
  }
  return 'pass'
}

function main() {
  var reportPath = process.argv[2]
  var outPath = process.argv[3] || 'playwright-checks.json'

  var summary = {checks: {}, failed: [], total: 0, passed: 0, skipped: 0}

  if (!reportPath || !fs.existsSync(reportPath)) {
    summary.error = 'no playwright report at ' + reportPath
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
    reportOutputs(summary)
    console.error(summary.error)
    process.exit(0)
  }

  var report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  var specs = walk(report, [])

  // A suite that blew up before running anything reports zero specs and a
  // populated errors array. Without this, that reads as "nothing failed".
  summary.suite_errors = (report.errors || []).length
  if (summary.suite_errors) {
    summary.error = report.errors.map(function(err) {
      return String(err && (err.message || err.value || err)).split('\n')[0]
    }).slice(0, 3).join(' | ')
  }

  specs.forEach(function(spec) {
    var status = specStatus(spec)
    var title = spec.title || ''

    summary.total++
    if (status === 'pass') {
      summary.passed++
    }
    else if (status === 'skip') {
      summary.skipped++
    }
    else {
      summary.failed.push(title)
    }

    var tag = /\[check:([a-z0-9_]+)\]/.exec(title)
    if (!tag) {
      return
    }
    var key = tag[1]
    summary.checks[key] = layers.merge(summary.checks[key], status)
  })

  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  reportOutputs(summary)
}

main()
