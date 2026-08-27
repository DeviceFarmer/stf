//
// The per-leg check columns, in the order a leg proves them, in one place.
//
// The order is semantic: android-verdict.js names the deepest layer that broke
// by walking it, and render-report.js renders one table column per entry in the
// same order. Splitting the list across files let the two disagree.
//
// The first eight are device capability, most fundamental first. `teardown` is
// last because it is about the runner rather than the device, and it is only
// knowable once the leg script has exited.
//
// usage: node checks.js seed <checks.json>
//

var fs = require('fs')

// seed    what a leg records before it has reached the layer. `image` is the
//         exception: reaching the leg script at all proves the image exists,
//         and an unpublished one is recorded by the workflow instead.
// gating  whether a failure fails the leg. The dashboard shell widget is a
//         convenience, not part of "is this device usable".
// failure how android-verdict.js words a failure of this layer.
// blurb   how the report's legend explains the column.
var LAYERS = [
  {
    key: 'image'
  , label: 'Image'
  , seed: 'pass'
  , gating: true
  , failure: 'no published system image for that api and arch'
  , blurb: 'a system image is published for that API and arch'
  }
, {
    key: 'emulator_boot'
  , label: 'Boot'
  , seed: 'skip'
  , gating: true
  , failure: 'the emulator never booted'
  , blurb: 'emulator reached `sys.boot_completed` and answers adb'
  }
, {
    key: 'stf_device_present'
  , label: 'In STF'
  , seed: 'skip'
  , gating: true
  , failure: 'STF never saw the device'
  , blurb: 'the device registered with the STF provider'
  }
, {
    key: 'stf_device_usable'
  , label: 'Usable'
  , seed: 'skip'
  , gating: true
  , failure: 'STF never marked the device present and ready'
  , blurb: 'STF offered it as `Use` and handed over control'
  }
, {
    key: 'screen_stream'
  , label: 'Screen'
  , seed: 'skip'
  , gating: true
  , failure: 'no minicap frames reached the browser'
  , blurb: 'minicap frames reached the browser canvas and kept changing'
  }
, {
    key: 'touch_roundtrip'
  , label: 'Touch'
  , seed: 'skip'
  , gating: true
  , failure: 'browser gestures did not reach the device'
  , blurb: 'a browser tap and swipe showed up in `getevent` on the device, at ' +
      'the coordinates they were aimed at: the tap within 5% of the centre of ' +
      'the touch axes, the swipe descending monotonically from 0.75 to 0.25 ' +
      '(the emulator runs with `adb root`, which minitouch needs to open ' +
      '`/dev/input`)'
  }
, {
    key: 'device_shell'
  , label: 'Shell'
  , seed: 'skip'
  , gating: false
  , failure: 'the shell widget did not run a command'
  , blurb: 'the dashboard shell widget ran a command on it'
  }
, {
    key: 'playwright_ui'
  , label: 'UI E2E'
  , seed: 'skip'
  , gating: true
  , failure: 'the web UI suite failed'
  , blurb: 'the rest of the Playwright web UI suite'
  }
, {
    key: 'teardown'
  , label: 'Teardown'
  , seed: 'skip'
  , gating: false
  , failure: 'the emulator step did not exit cleanly after every check had passed'
  , blurb: 'the emulator action shut the AVD down and exited on its own'
  }
]

// Precedence when two sources report the same layer: a failure anywhere wins,
// and one source reaching a layer beats another that never got to it. So a
// single `pass` does promote a `skip`; it is only `fail` that is sticky.
var RANK = {fail: 3, pass: 2, skip: 1}

function merge(current, incoming) {
  return RANK[incoming] > (RANK[current] || 0) ? incoming : current
}

function seed() {
  var values = {}
  LAYERS.forEach(function(layer) {
    values[layer.key] = layer.seed
  })
  return values
}

function legend() {
  return LAYERS.map(function(layer) {
    return layer.label + ' = ' + layer.blurb + '.'
  }).join(' ')
}

module.exports = {
  LAYERS: LAYERS
, merge: merge
, seed: seed
, legend: legend
}

if (require.main === module) {
  if (process.argv[2] !== 'seed' || !process.argv[3]) {
    console.error('usage: checks.js seed <checks.json>')
    process.exit(2)
  }
  var values = seed()
  fs.writeFileSync(process.argv[3], JSON.stringify(values, null, 2))
  Object.keys(values).forEach(function(key) {
    console.log('check ' + key + ' = ' + values[key])
  })
}
