//
// Tests that need a real (emulated) device attached to stf local.
//
// Skipped entirely unless STF_DEVICE_SERIAL is set, so the same suite runs in
// the device-less integration job.
//
// Test titles carry a [check:<key>] tag; .github/scripts/playwright-checks.js
// turns those into the per-Android-version columns of the PR report.
//

const {test, expect} = require('@playwright/test')
const h = require('./helpers')

const SERIAL = process.env.STF_DEVICE_SERIAL

test.describe('STF against a real device', function() {
  // No retries. In serial mode a retry reruns the whole group, and by then this
  // user already holds the device, so the tile reads state-using instead of
  // state-available. A late touch or shell failure would come back looking like
  // a failure at the claim layer, which defeats the point of the layered report.
  test.describe.configure({mode: 'serial', retries: 0})
  test.skip(!SERIAL, 'STF_DEVICE_SERIAL is not set')

  let page

  test.beforeAll(async function({browser}, testInfo) {
    const context = await browser.newContext({
      viewport: {width: 1600, height: 1000}
    , // browser.newContext does not inherit the config's `use` options, so the
      // recording has to be asked for here. One video covers the whole group,
      // since the context outlives the individual tests.
      recordVideo: {
        dir: testInfo.outputPath('session')
      , size: {width: 1280, height: 800}
      }
    })
    page = await context.newPage()
    await h.login(page)
  })

  test.afterAll(async function() {
    if (page) {
      await page.context().close()
    }
  })

  test('[check:stf_device_present] the device shows up in the device list',
    async function() {
      await page.goto('/#!/devices')
      await h.waitForDeviceTile(page)

      const tile = page.locator(h.SEL.deviceTiles).filter({
        has: page.locator('a[href="#!/control/' + SERIAL + '"]')
      })
      await expect(tile, 'a tile for ' + SERIAL).toHaveCount(1, {
        timeout: 180000
      })
      await expect(tile.locator('.device-name')).not.toHaveText('')
    })

  test('[check:stf_device_usable] the device can be claimed with Use',
    async function() {
      const tile = page.locator(h.SEL.deviceTiles).filter({
        has: page.locator('a[href="#!/control/' + SERIAL + '"]')
      })

      // state-available means STF has it present, ready and unclaimed.
      // Anything else (preparing, offline, unauthorized) is not usable.
      await expect(
        tile.locator(h.SEL.availableMarker)
      , 'STF offers ' + SERIAL + ' as available'
      ).toHaveCount(1, {timeout: 240000})

      await tile.locator(h.SEL.deviceName).first().click()

      await page.waitForURL(new RegExp('#!/control/'), {timeout: 90000})
      await expect(page.locator(h.SEL.screen)).toBeVisible({timeout: 60000})

      // Stop Using only renders once the group invite went through, so this is
      // the proof that we actually hold the device rather than just landing on
      // its page.
      await expect(
        page.locator(h.SEL.stopUsing)
      , 'the device was handed over to us'
      ).toBeVisible({timeout: 90000})

      // Force Native, otherwise a persisted Web setting removes the shell.
      const toggle = page.locator(h.SEL.nativeToggle)
      if (await toggle.count()) {
        await toggle.click()
      }
    })

  test('[check:screen_stream] minicap frames reach the browser canvas',
    async function() {
      const canvas = page.locator(h.SEL.canvas)
      await expect(canvas).toBeVisible({timeout: 60000})

      // The canvas keeps its default 300x150 intrinsic size until the first
      // frame is decoded, so any other size is the frames-arrived signal. Do
      // not compare against a width, some AVDs are only 320px wide.
      await expect.poll(async function() {
        return canvas.evaluate(function(el) {
          return el.width + 'x' + el.height
        })
      }, {timeout: 120000, message: 'canvas never received a frame'})
        .not.toBe('300x150')

      await expect(page.locator(h.SEL.screenError)).toHaveCount(0)

      // One frame is not a stream. Nudge the device so the picture has to
      // change, then confirm the pixels really did.
      const before = await canvas.evaluate(function(el) {
        return el.toDataURL()
      })
      await page.click('a[device-control-key="app_switch"]')
      await page.waitForTimeout(2500)
      await page.click('a[device-control-key="home"]')

      await expect.poll(async function() {
        const now = await canvas.evaluate(function(el) {
          return el.toDataURL()
        })
        return now !== before
      }, {timeout: 60000, message: 'canvas pixels never changed'})
        .toBeTruthy()
    })

  test('[check:touch_roundtrip] a tap in the browser becomes a touch on the device',
    async function({}, testInfo) {
      const ranges = await h.touchAxisRanges(SERIAL)
      let positions = {device: null, x: [], y: []}
      let fractions = null
      const recorder = h.recordDeviceScreen(SERIAL)
      const capture = h.captureInputEvents(SERIAL)
      try {
        await page.waitForTimeout(1000)

        await h.tapDeviceScreen(page, 0.5, 0.5)
        await page.waitForTimeout(2000)

        const log = await capture.stop()
        expect(
          h.isPermissionProblem(log) || h.isCaptureBroken(log)
        , 'the getevent capture itself did not work, so this says nothing ' +
          'about touch:\n' + log.slice(0, 2000)
        ).toBeFalsy()
        expect(
          h.hasTouchEvents(log)
        , 'getevent saw no touch events on ' + SERIAL + ' during the tap:\n' +
          log.slice(0, 2000)
        ).toBeTruthy()

        positions = h.parseTouchPositions(log)
        fractions = h.toFractions(positions, ranges)

        // A tap that reached /dev/input proves minitouch ran. It does not prove
        // the coordinates survived the browser -> canvas -> minitouch transform,
        // and a transform that collapses every gesture onto an edge would still
        // pass the check above.
        expect(
          positions.x.length && positions.y.length
        , 'the tap produced no absolute position on either axis:\n' +
          log.slice(0, 2000)
        ).toBeTruthy()

        if (fractions) {
          expect(
            fractions.x[0]
          , 'the tap was aimed at the middle but landed at x=' + fractions.x[0]
          ).toBeCloseTo(0.5, 1)
          expect(
            fractions.y[0]
          , 'the tap was aimed at the middle but landed at y=' + fractions.y[0]
          ).toBeCloseTo(0.5, 1)
        }
        else {
          console.log('axis ranges unknown on ' + SERIAL + ', tap position ' +
            'checked for presence but not for where it landed')
        }
      }
      finally {
        await h.attachCapture(
          testInfo, 'getevent-tap', capture
        , h.describeGesture(positions, fractions, 'tap at 0.5, 0.5')
        )
        await h.saveRecording(recorder, testInfo, 'device-tap')
      }
    })

  test('[check:touch_roundtrip] a swipe in the browser becomes motion on the device',
    async function({}, testInfo) {
      const ranges = await h.touchAxisRanges(SERIAL)
      let positions = {device: null, x: [], y: []}
      let fractions = null
      const recorder = h.recordDeviceScreen(SERIAL)
      const capture = h.captureInputEvents(SERIAL)
      try {
        await page.waitForTimeout(1000)

        await h.swipeDeviceScreen(page, [0.5, 0.75], [0.5, 0.25])
        await page.waitForTimeout(2000)

        const log = await capture.stop()
        expect(
          h.isPermissionProblem(log) || h.isCaptureBroken(log)
        , 'the getevent capture itself did not work, so this says nothing ' +
          'about touch:\n' + log.slice(0, 2000)
        ).toBeFalsy()
        const moves = (log.match(/ABS_MT_POSITION_Y|ABS_Y/g) || []).length
        expect(
          moves
        , 'getevent saw ' + moves + ' motion events during the swipe:\n' +
          log.slice(0, 2000)
        ).toBeGreaterThan(1)

        positions = h.parseTouchPositions(log)
        fractions = h.toFractions(positions, ranges)

        // The swipe runs bottom to top, so Y has to fall. Counting events alone
        // cannot tell an upward swipe from a downward one, from two unrelated
        // taps, or from a gesture that never moved.
        const ys = positions.y
        expect(
          ys[ys.length - 1]
        , 'the swipe ran bottom to top, so the last Y (' + ys[ys.length - 1] +
          ') must be above the first (' + ys[0] + ')'
        ).toBeLessThan(ys[0])
        const descending = ys.every(function(y, i) {
          return i === 0 || y <= ys[i - 1]
        })
        expect(
          descending
        , 'the swipe Y samples are not monotonic, so this was not one clean ' +
          'gesture: ' + ys.join(' ')
        ).toBeTruthy()

        if (fractions) {
          expect(
            fractions.y[0]
          , 'the swipe should start at 0.75 down the screen'
          ).toBeCloseTo(0.75, 1)
          expect(
            fractions.y[fractions.y.length - 1]
          , 'the swipe should end at 0.25 down the screen'
          ).toBeCloseTo(0.25, 1)
        }
        else {
          console.log('axis ranges unknown on ' + SERIAL + ', swipe checked ' +
            'for direction but not for distance')
        }
      }
      finally {
        await h.attachCapture(
          testInfo, 'getevent-swipe', capture
        , h.describeGesture(positions, fractions, 'swipe from 0.5,0.75 to 0.5,0.25')
        )
        await h.saveRecording(recorder, testInfo, 'device-swipe')
      }
    })

  test('[check:device_shell] the shell widget runs a command on the device',
    async function() {
      const input = page.locator(h.SEL.shellInput)
      await expect(input, 'shell widget is present').toBeVisible({
        timeout: 30000
      })

      await input.fill('getprop ro.build.version.sdk')
      await input.press('Enter')

      await expect(page.locator(h.SEL.shellResults))
        .toHaveText(/\d+/, {timeout: 60000})
    })

  test('[check:playwright_ui] releasing the device returns to the device list',
    async function() {
      await page.click(h.SEL.stopUsing)
      await page.waitForURL(/#!\/devices/, {timeout: 60000})
      await expect(page.locator(h.SEL.deviceList)).toBeVisible()
    })
})
