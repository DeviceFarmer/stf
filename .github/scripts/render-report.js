//
// Aggregate the per-job verdict JSON files into one short PR report.
//
// usage: node render-report.js <verdicts-dir> <output.md>
//

var fs = require('fs')
var path = require('path')
var layers = require('./checks')

var ICON = {
  pass: ':white_check_mark:'
, fail: ':x:'
, skip: ':fast_forward:'
, cancel: ':heavy_minus_sign:'
, unknown: ':question:'
}

var CHECK_ICON = {
  pass: ':white_check_mark:'
, fail: ':x:'
, warn: ':warning:'
, skip: ':heavy_minus_sign:'
, 'n/a': ':heavy_minus_sign:'
}

// Labels have to match what each job passes to verdict.sh, or the table wording
// changes depending on whether the job lived long enough to report.
var CORE_LABELS = {
  build: 'Build (npm + bower + webpack)'
, lint: 'Lint (eslint + jsonlint + workflow shell)'
, unit: 'Unit tests (mocha)'
, component: 'Component tests (karma + AngularJS)'
, integration:
    'Integration + device-less E2E (stf local + RethinkDB + Playwright)'
}

var CORE_ORDER = Object.keys(CORE_LABELS)

var NO_VERDICT = 'no verdict: it never ran, was cancelled, or died before ' +
  'reporting'

// EXPECTED_ANDROID_FILE points at the same JSON the matrix is generated from,
// so a leg cannot be added to the matrix and silently escape the coverage
// check.
function expectedAndroid() {
  var file = process.env.EXPECTED_ANDROID_FILE

  if (file && fs.existsSync(file)) {
    try {
      var spec = JSON.parse(fs.readFileSync(file, 'utf8'))
      return (spec.include || []).map(function(leg) {
        return {android: String(leg.android), api: String(leg.api)}
      })
    }
    catch (e) {
      console.error('cannot read %s: %s', file, e.message)
    }
  }

  return []
}

// A job that dies before it can write its verdict must not read as green, so
// anything we expected and did not receive counts as a failure.
function addMissing(verdicts) {
  var seen = {}
  verdicts.forEach(function(v) {
    seen[v.id] = true
  })

  var missing = []

  ;(process.env.EXPECTED_TIERS || '').trim().split(/\s+/)
    .filter(Boolean)
    .forEach(function(id) {
      if (!seen[id]) {
        missing.push({
          id: id
        , label: CORE_LABELS[id] || id
        , group: ''
        , status: 'fail'
        , details: NO_VERDICT
        })
      }
    })

  expectedAndroid().forEach(function(leg) {
    if (!seen['android-' + leg.api]) {
      missing.push({
        id: 'android-' + leg.api
      , label: 'Android ' + leg.android + ' (API ' + leg.api + ')'
      , group: 'android'
      , status: 'fail'
      , android: leg.android
      , api: leg.api
      , checks: {}
      , details: NO_VERDICT
      })
    }
  })

  return verdicts.concat(missing)
}

function collect(dir) {
  var verdicts = []
  if (!fs.existsSync(dir)) {
    return verdicts
  }
  fs.readdirSync(dir).forEach(function(entry) {
    var full = path.join(dir, entry)
    var stat = fs.statSync(full)
    if (stat.isDirectory()) {
      verdicts = verdicts.concat(collect(full))
    }
    else if (/\.json$/.test(entry)) {
      try {
        var parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
        if (parsed && parsed.id) {
          verdicts.push(parsed)
        }
      }
      catch (e) {
        console.error('skipping unparsable verdict %s: %s', full, e.message)
      }
    }
  })
  return verdicts
}

function icon(status) {
  return ICON[status] || ICON.unknown
}

function checkIcon(status) {
  if (!status) {
    return CHECK_ICON['n/a']
  }
  return CHECK_ICON[status] || ICON.unknown
}

function tally(list) {
  var counts = {pass: 0, fail: 0, skip: 0, cancel: 0}
  list.forEach(function(v) {
    if (counts[v.status] === undefined) {
      counts[v.status] = 0
    }
    counts[v.status]++
  })
  return counts
}

function main() {
  var dir = process.argv[2] || 'verdicts'
  var out = process.argv[3] || 'report.md'

  var verdicts = addMissing(collect(dir))
  var android = verdicts.filter(function(v) {
    return v.group === 'android'
  }).sort(function(a, b) {
    return Number(a.api) - Number(b.api)
  })
  var core = verdicts.filter(function(v) {
    return v.group !== 'android'
  }).sort(function(a, b) {
    var ai = CORE_ORDER.indexOf(a.id)
    var bi = CORE_ORDER.indexOf(b.id)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  var coreCounts = tally(core)
  var androidCounts = tally(android)
  var failed = coreCounts.fail + androidCounts.fail
  var lines = []

  // Nothing reported at all means the run died before any job could speak.
  // Decide this before the headline is written, not after.
  if (!verdicts.length) {
    failed = 1
  }

  lines.push('<!-- stf-ci-report -->')
  lines.push('## ' + (failed ? ':x:' : ':white_check_mark:') + ' STF CI report')
  lines.push('')

  var androidReady = android.filter(function(v) {
    return v.checks && v.checks.stf_device_usable === 'pass'
  }).length

  lines.push([
    '**' + (failed ? failed + ' failing' : 'All green') + '**'
  , core.length + ' test tiers (' + coreCounts.pass + ' pass / ' +
      coreCounts.fail + ' fail / ' + coreCounts.skip + ' skip)'
  , android.length + ' Android versions (' + androidReady +
      ' with a usable device in STF)'
  ].join(' &nbsp;·&nbsp; '))
  lines.push('')

  if (core.length) {
    lines.push('### Test tiers')
    lines.push('')
    lines.push('| | Tier | Result |')
    lines.push('|---|---|---|')
    core.forEach(function(v) {
      lines.push('| ' + icon(v.status) + ' | ' + v.label + ' | ' +
        (v.details || v.status) + ' |')
    })
    lines.push('')
  }

  if (android.length) {
    lines.push('### Android device matrix')
    lines.push('')
    var header = ['', 'Android', 'API'].concat(layers.LAYERS.map(function(l) {
      return l.label
    }))
    lines.push('| ' + header.join(' | ') + ' |')
    lines.push('|' + header.map(function() {
      return '---'
    }).join('|') + '|')

    android.forEach(function(v) {
      var checks = v.checks || {}
      var row = [
        icon(v.status)
      , v.android ? String(v.android) : '?'
      , v.api ? String(v.api) : '?'
      ].concat(layers.LAYERS.map(function(l) {
        return checkIcon(checks[l.key])
      }))
      lines.push('| ' + row.join(' | ') + ' |')
    })
    lines.push('')
    lines.push('<sub>' + layers.legend() + '</sub>')
    lines.push('')
  }

  var problems = verdicts.filter(function(v) {
    return v.status === 'fail' && v.details
  })
  if (problems.length) {
    lines.push('### Failures')
    lines.push('')
    problems.forEach(function(v) {
      lines.push('- **' + v.label + '**: ' + v.details)
    })
    lines.push('')
  }

  var skipped = android.filter(function(v) {
    return v.checks && v.checks.image === 'skip'
  })
  if (skipped.length) {
    lines.push('> :information_source: No published system image for ' +
      skipped.map(function(v) {
        return 'Android ' + v.android + ' (API ' + v.api + ')'
      }).join(', ') + '. Those legs self-skipped instead of failing.')
    lines.push('')
  }

  if (!verdicts.length) {
    lines.push(':warning: No job reported anything at all. The run died very ' +
      'early; check the run log.')
    lines.push('')
  }

  lines.push('<sub>Logs, screenshots, logcat and Playwright traces are ' +
    'attached to the run as artifacts · ' +
    '[full run](' + (process.env.GITHUB_SERVER_URL || 'https://github.com') +
    '/' + (process.env.GITHUB_REPOSITORY || '') + '/actions/runs/' +
    (process.env.GITHUB_RUN_ID || '') + ')' +
    (process.env.GITHUB_SHA ? ' · commit `' +
      process.env.GITHUB_SHA.slice(0, 7) + '`' : '') + '</sub>')

  var markdown = lines.join('\n') + '\n'
  fs.writeFileSync(out, markdown)
  process.stdout.write(markdown)

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'failed=' + failed + '\n')
  }
}

main()
