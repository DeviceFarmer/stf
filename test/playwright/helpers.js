//
// Shared helpers for the Playwright suite.
//
// Selectors here come from the STF sources, not from guesses:
//   login form      res/auth/mock/scripts/signin/signin.pug
//   device tiles    res/app/device-list/icons/device-list-icons-directive.js
//   control page    res/app/control-panes/device-control/device-control.pug
//   screen widget   res/app/components/stf/screen/screen-directive.js
//

const {spawn} = require('child_process')
const fs = require('fs')

// dbapi.checkUserBeforeLogin rejects a known email that arrives with a
// different name, so this pair has to stay stable across runs.
const USER_NAME = process.env.STF_USERNAME || 'ci_user'
const USER_EMAIL = process.env.STF_EMAIL || 'ci_user@ci.local'

const SEL = {
  loginForm: 'form[name="signin"]',
  loginName: 'input[name="username"]',
  loginEmail: 'input[name="email"]',
  loginSubmit: 'input[value="Log In"]',
  loginError: '.alert.alert-danger',

  deviceList: '.stf-device-list',
  deviceTiles: 'ul.devices-icon-view > li:not(.filter-out)',
  deviceSearch: 'input[name="deviceFilter"]',
  deviceName: 'div.device-name',
  // In the icon view the Use button is display:none
  // (res/app/device-list/icons/device-list-icons.css), because the whole tile
  // is the link. So state-available is a marker to assert on, never to click.
  availableMarker: 'button.device-status.state-available',

  screen: 'device-screen',
  canvas: 'device-screen canvas.screen',
  screenError: 'device-screen .screen-error',
  nativeToggle: '.stf-nav-web-native-button button:has-text("Native")',
  stopUsing: '.stf-vnc-right-buttons button.btn-danger-outline',
  shellInput: '.stf-shell input.shell-input',
  // The empty state is a second pre.shell-results, so exclude it or the
  // locator resolves to two elements and strict mode rejects it.
  shellResults: '.stf-shell pre.shell-results:not(.shell-results-empty)',
  version: '.stf-menu .version-text'
}

async function login(page) {
  await page.goto('/auth/mock/')
  await page.waitForSelector(SEL.loginSubmit)
  await page.fill(SEL.loginName, USER_NAME)
  await page.fill(SEL.loginEmail, USER_EMAIL)
  await page.click(SEL.loginSubmit)
  await page.waitForURL(/#!\/devices/, {timeout: 90000})
  await page.waitForSelector(SEL.deviceList)
}

// The device list is fed by the provider over websocket, so a freshly booted
// emulator can take a while to show up.
async function waitForDeviceTile(page, timeout) {
  await page.locator(SEL.deviceTiles).first().waitFor({
    state: 'visible'
  , timeout: timeout || 180000
  })
}

async function collectConsoleErrors(page) {
  const errors = []
  page.on('console', function(msg) {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })
  page.on('pageerror', function(err) {
    errors.push(String(err && err.message))
  })
  return errors
}

// Ask the device itself whether raw input events arrived. This is the only
// honest check that a browser gesture became a real touch: STF drives minitouch
// on the device, and minitouch writes to a uinput device that getevent sees.
function captureInputEvents(serial, seconds) {
  const args = serial ? ['-s', serial] : []
  // A pty makes getevent's stdout line buffered. Without one it is a pipe, so
  // event lines sit in a 4K buffer and are lost when the capture is killed,
  // which reads as "no touch reached the device". Two -t are required here:
  // with one adb answers "Remote PTY will not be allocated because stdin is
  // not a terminal. Use multiple -t options to force remote PTY allocation."
  const child = spawn(
    'adb'
  , args.concat(['shell', '-t', '-t', 'getevent', '-l'])
  , {stdio: ['ignore', 'pipe', 'pipe']}
  )

  let out = ''
  child.stdout.on('data', function(chunk) {
    out += chunk.toString()
  })
  child.stderr.on('data', function(chunk) {
    out += chunk.toString()
  })

  return {
    text: function() {
      return out
    }
  , stop: function() {
      return new Promise(function(resolve) {
        const finish = function() {
          resolve(out)
        }
        child.on('close', finish)
        try {
          child.kill('SIGKILL')
        }
        catch (e) {
          finish()
        }
        setTimeout(finish, (seconds || 5) * 1000)
      })
    }
  }
}

// Attach what getevent actually saw, so a green touch verdict can be checked
// rather than taken on trust.
// `header` carries what the capture cannot say about itself: which device node
// the events came from, that node's axis ranges, and where the gesture actually
// landed once scaled. Without it a capture of a deterministic gesture is
// byte-identical across legs and binds to none of them.
async function attachCapture(testInfo, name, capture, header) {
  const text = capture.text()
  await testInfo.attach(name, {
    body: (header ? header + '\n\n' : '') +
      (text.slice(0, 200000) || '(getevent produced nothing)')
  , contentType: 'text/plain'
  })
}

// One line per axis: "y 0.7501 0.6995 ... 0.2499 (of max 32767)".
function describeGesture(positions, fractions, aimed) {
  const round = function(v) {
    return Math.round(v * 10000) / 10000
  }
  const lines = ['aimed at: ' + aimed]
  lines.push('device:   ' + (positions.device || 'none'))
  if (!fractions) {
    lines.push(positions.x.length || positions.y.length
      ? 'axis ranges unknown, positions are raw: x=' +
        positions.x.join(',') + ' y=' + positions.y.join(',')
      : 'no absolute positions were captured')
    return lines.join('\n')
  }
  lines.push('axis max: x=' + fractions.max.x + ' y=' + fractions.max.y)
  ;['x', 'y'].forEach(function(axis) {
    if (fractions[axis].length) {
      lines.push(axis + ' landed: ' + fractions[axis].map(round).join(' '))
    }
  })
  return lines.join('\n')
}

// Record the device screen itself while a gesture runs, so a touch failure can
// be watched instead of only read in getevent. Best effort: screenrecord needs
// an encoder the emulator does not always have, and a missing recording must
// never fail a test.
function recordDeviceScreen(serial, seconds) {
  const args = serial ? ['-s', serial] : []
  const remote = '/data/local/tmp/stf-ci-' + Date.now() + '.mp4'
  const child = spawn(
    'adb'
  , args.concat([
      'shell', 'screenrecord', '--bit-rate', '2000000'
    , '--time-limit', String(seconds || 60), remote
    ])
  , {stdio: ['ignore', 'pipe', 'pipe']}
  )

  let out = ''
  child.stdout.on('data', function(chunk) {
    out += chunk.toString()
  })
  child.stderr.on('data', function(chunk) {
    out += chunk.toString()
  })

  return {
    log: function() {
      return out
    }
  , stop: async function(localPath) {
      // screenrecord only writes the mp4 header when it gets SIGINT, and
      // killing the local adb client does not signal the process on the
      // device, so it has to be signalled there.
      await adb(args, [
        'shell', 'pkill -INT screenrecord || killall -INT screenrecord'
      ])
      await closed(child, 15000)
      // The adb client can return before screenrecord has written the moov
      // atom, and a file pulled at that point has no duration. Wait for the
      // process to actually be gone.
      await gone(args, 5000)
      await adb(args, ['pull', remote, localPath])
      await adb(args, ['shell', 'rm', '-f', remote])

      try {
        if (fs.statSync(localPath).size > 0) {
          return localPath
        }
      }
      catch (e) {
        // Nothing was pulled.
      }
      return null
    }
  }
}

// Attach a recording to the Playwright report if there is one. Returns the
// path, or null when the device could not record.
async function saveRecording(recorder, testInfo, name) {
  let file = null
  try {
    file = await recorder.stop(testInfo.outputPath(name + '.mp4'))
  }
  catch (e) {
    file = null
  }

  if (file) {
    await testInfo.attach(name, {path: file, contentType: 'video/mp4'})
  }
  else {
    console.log('no device recording for ' + name + ': ' + recorder.log())
  }
  return file
}

function adb(args, rest) {
  return new Promise(function(resolve) {
    const child = spawn('adb', args.concat(rest), {stdio: 'ignore'})
    child.on('close', function(code) {
      resolve(code)
    })
    child.on('error', function() {
      resolve(-1)
    })
  })
}

// pidof exits non-zero once nothing matches, and also when the image has no
// pidof at all, which is the same "stop waiting" answer.
async function gone(args, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await adb(args, ['shell', 'pidof screenrecord']) !== 0) {
      return
    }
    await new Promise(function(resolve) {
      setTimeout(resolve, 250)
    })
  }
}

function closed(child, timeout) {
  return new Promise(function(resolve) {
    if (child.exitCode !== null || child.signalCode) {
      return resolve()
    }
    const done = function() {
      resolve()
    }
    child.on('close', done)
    setTimeout(done, timeout)
  })
}

function hasTouchEvents(log) {
  return /ABS_MT_POSITION_X|ABS_MT_TRACKING_ID|BTN_TOUCH|ABS_X/.test(log)
}

// `getevent -l` prints event values but never the axis ranges, so the captured
// positions mean nothing on their own: 16383 is the middle of a 0..32767
// touchscreen and the far right of a 0..16383 one. Ask the device for its ranges
// once so a capture can be scaled back into the 0..1 the gesture was aimed at.
function touchAxisRanges(serial) {
  const args = serial ? ['-s', serial] : []
  return new Promise(function(resolve) {
    const child = spawn('adb', args.concat(['shell', 'getevent', '-p']), {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', function(chunk) {
      out += chunk.toString()
    })
    child.stderr.on('data', function(chunk) {
      out += chunk.toString()
    })
    child.on('error', function() {
      resolve({})
    })
    child.on('close', function() {
      resolve(parseAxisRanges(out))
    })
  })
}

// One entry per input device that reports absolute positions:
//   {'/dev/input/event1': {x: 32767, y: 32767}}
// The `ABS (0003):` prefix only appears on the first axis of the block, the rest
// are bare codes, so match the code and the max independently of the prefix.
// 0035 is ABS_MT_POSITION_X, 0036 is ABS_MT_POSITION_Y, 0000/0001 are ABS_X/Y.
function parseAxisRanges(text) {
  const ranges = {}
  let device = null

  text.split(/\r?\n/).forEach(function(line) {
    const add = line.match(/^add device\s+\d+:\s*(\S+)/)
    if (add) {
      device = add[1]
      return
    }
    if (!device) {
      return
    }
    const axis = line.match(
      /^\s*(?:ABS \(0003\):\s*)?([0-9a-fA-F]{4})\s*:.*\bmax\s+(-?\d+)/
    )
    if (!axis) {
      return
    }
    const code = axis[1].toLowerCase()
    const max = parseInt(axis[2], 10)
    if (!(max > 0)) {
      return
    }
    const key = (code === '0035' || code === '0000') ? 'x'
      : (code === '0036' || code === '0001') ? 'y'
        : null
    if (!key) {
      return
    }
    ranges[device] = ranges[device] || {}
    // A device that reports both ABS_X and ABS_MT_POSITION_X keeps the MT one,
    // because that is the axis minitouch drives.
    if (ranges[device][key] === undefined || code === '0035' || code === '0036') {
      ranges[device][key] = max
    }
  })

  return ranges
}

// Pull the ordered positions out of a `getevent -l` capture. Values are hex.
// Returns the device that reported the most positions plus its samples, since a
// capture covers every input device on the box (keyboard, mouse, rotary).
function parseTouchPositions(log) {
  const byDevice = {}

  log.split(/\r?\n/).forEach(function(line) {
    const m = line.match(
      /^(\S+):\s+EV_ABS\s+(ABS_MT_POSITION_X|ABS_MT_POSITION_Y|ABS_X|ABS_Y)\s+([0-9a-fA-F]+)/
    )
    if (!m) {
      return
    }
    const device = m[1]
    const axis = /_X$/.test(m[2]) ? 'x' : 'y'
    byDevice[device] = byDevice[device] || {x: [], y: []}
    byDevice[device][axis].push(parseInt(m[3], 16))
  })

  const devices = Object.keys(byDevice)
  if (!devices.length) {
    return {device: null, x: [], y: []}
  }
  const best = devices.sort(function(a, b) {
    const count = function(d) {
      return byDevice[d].x.length + byDevice[d].y.length
    }
    return count(b) - count(a)
  })[0]

  return {device: best, x: byDevice[best].x, y: byDevice[best].y}
}

// Scale captured positions into 0..1 using the axis ranges, so they can be
// compared against the fractions the gesture was aimed at. Returns null when the
// ranges for that device are unknown, which the caller reports rather than
// silently treating as a pass.
function toFractions(positions, ranges) {
  if (!positions.device) {
    return null
  }
  const axes = ranges[positions.device]
  if (!axes || !(axes.x > 0) || !(axes.y > 0)) {
    return null
  }
  return {
    device: positions.device
  , max: axes
  , x: positions.x.map(function(v) {
      return v / axes.x
    })
  , y: positions.y.map(function(v) {
      return v / axes.y
    })
  }
}

// getevent needs read access to /dev/input. On a Play Store image adbd cannot
// run as root, and a permission error there says nothing about whether the
// touch itself worked, so name it rather than reporting broken touch.
function isPermissionProblem(log) {
  return /Permission denied|not permitted|Operation not permitted/i.test(log)
}

// If adb never gave us a pty the capture is unreliable, which says nothing
// about whether the touch itself worked.
function isCaptureBroken(log) {
  return /PTY will not be allocated/i.test(log)
}

// device-screen is letterboxed around the real image, so aim at the canvas box
// and dispatch on the element that actually listens (canvas has
// pointer-events: none by design).
async function tapDeviceScreen(page, fx, fy) {
  const box = await page.locator(SEL.canvas).boundingBox()
  if (!box) {
    throw new Error('device screen canvas has no box, screen is not rendered')
  }
  const x = box.x + (fx === undefined ? 0.5 : fx) * box.width
  const y = box.y + (fy === undefined ? 0.5 : fy) * box.height

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.up()
  return {x: x, y: y, box: box}
}

async function swipeDeviceScreen(page, from, to) {
  const box = await page.locator(SEL.canvas).boundingBox()
  if (!box) {
    throw new Error('device screen canvas has no box, screen is not rendered')
  }
  const point = function(f) {
    return [box.x + f[0] * box.width, box.y + f[1] * box.height]
  }
  const start = point(from)
  const end = point(to)

  await page.mouse.move(start[0], start[1])
  await page.mouse.down()
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(
      start[0] + (end[0] - start[0]) * step / 10
    , start[1] + (end[1] - start[1]) * step / 10
    )
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
}

module.exports = {
  SEL,
  USER_NAME,
  USER_EMAIL,
  login,
  waitForDeviceTile,
  collectConsoleErrors,
  captureInputEvents,
  attachCapture,
  recordDeviceScreen,
  saveRecording,
  hasTouchEvents,
  isPermissionProblem,
  isCaptureBroken,
  touchAxisRanges,
  parseAxisRanges,
  describeGesture,
  parseTouchPositions,
  toFractions,
  tapDeviceScreen,
  swipeDeviceScreen
}
