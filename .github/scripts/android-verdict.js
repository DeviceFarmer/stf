//
// Turn one Android leg's checks.json into a verdict status + details string.
//
// Reads CHECKS_FILE, ANDROID_VERSION, ANDROID_API, ANDROID_TARGET from the
// environment and appends status / details / extra to $GITHUB_OUTPUT.
//

var fs = require('fs')
var layers = require('./checks')

function main() {
  var checksPath = process.env.CHECKS_FILE || 'checks.json'
  var checks = {}

  try {
    checks = JSON.parse(fs.readFileSync(checksPath, 'utf8'))
  }
  catch (e) {
    checks = {}
  }

  var status
  var details
  var outcome = process.env.EMULATOR_OUTCOME || ''
  var gating = layers.LAYERS.filter(function(layer) {
    return layer.gating
  })
  var failed = gating.filter(function(layer) {
    return checks[layer.key] === 'fail'
  })
  // Anything that is not an explicit pass counts as unreached, not just "skip".
  // A gating key that is missing entirely means the seed never landed, and
  // treating that as satisfied would report a leg green having done nothing.
  var unreached = gating.filter(function(layer) {
    return checks[layer.key] !== 'pass' && checks[layer.key] !== 'fail'
  })
  // Read before the teardown write below, which would otherwise make an empty
  // checks.json look populated.
  var nothingRan = !Object.keys(checks).length

  // Teardown is the one layer the leg cannot record, because it happens after
  // the script exits. A step that did not exit cleanly having already passed
  // everything hung on the way out; anything else is named by the verdict below,
  // and blaming teardown too would misattribute the same failure twice.
  checks.teardown = outcome === 'success' ? 'pass' :
    (!failed.length && !unreached.length &&
      (outcome === 'failure' || outcome === 'cancelled')) ? 'warn' : 'skip'

  if (checks.image === 'skip') {
    status = 'skip'
    details = 'no published system image for API ' +
      (process.env.ANDROID_API || '?') + ' ' + (process.env.ANDROID_ARCH || '')
  }
  else if (nothingRan) {
    // The leg script seeds every check before it does anything, so no checks at
    // all means the emulator step never handed control over: AVD creation or
    // boot ran out the clock.
    status = 'fail'
    details = 'the emulator never finished booting, so nothing ran against it' +
      (outcome ? ' (emulator step: ' + outcome + ')' : '')
  }
  else {
    var softFailed = layers.LAYERS.filter(function(layer) {
      return !layer.gating &&
        (checks[layer.key] === 'fail' || checks[layer.key] === 'warn')
    })

    if (failed.length) {
      status = 'fail'
      details = failed.map(function(layer) {
        return layer.failure
      }).join('; ')
    }
    else if (unreached.length) {
      status = 'fail'
      details = 'stopped before: ' + unreached.map(function(layer) {
        return layer.key
      }).join(', ')
    }
    else {
      status = 'pass'
      details = 'usable device, screen streaming, touch confirmed on the device'
      if (softFailed.length) {
        details += ' (but ' + softFailed.map(function(layer) {
          return layer.failure
        }).join('; ') + ')'
      }
    }
  }

  var extra = {
    checks: checks
  , android: process.env.ANDROID_VERSION || ''
  , api: process.env.ANDROID_API || ''
  , target: process.env.ANDROID_TARGET || ''
  , arch: process.env.ANDROID_ARCH || ''
  }

  var out = [
    'status=' + status
  , 'details=' + details.replace(/\r?\n/g, ' ')
  , 'extra=' + JSON.stringify(extra)
  ].join('\n') + '\n'

  if (checks.teardown === 'warn') {
    process.stdout.write('::warning::Android ' + extra.android + ' (API ' +
      extra.api + ') passed every check, then hung in emulator teardown\n')
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, out)
  }
  process.stdout.write(out)
}

main()
