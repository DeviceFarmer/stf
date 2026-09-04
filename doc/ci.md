# CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to
`master`. Everything runs on `ubuntu-24.04` and needs no secrets: the only
token involved is the automatic `GITHUB_TOKEN`, used to post the report.

`.github/workflows/docker.yml` builds the images on the same events, and
`prepare-release.yml` and `release.yml` cut a release between them. Neither
holds a stored credential either: both registries are reached over OIDC,
described under Releasing below.

## What runs

| Job | What it proves |
|---|---|
| `plan` | `.github/android-matrix.json` is well formed, and produces the Android matrix |
| `build` | `npm install`, `bower install` and the webpack bundle all succeed, and `stf -V` runs |
| `lint` | `gulp lint` (eslint over `lib/`, `res/`, root JS, plus jsonlint) |
| `unit` | `mocha` over `test/` (`lib/util`, `lib/wire`) |
| `component` | `karma` + headless Chrome over the 82 AngularJS specs in `res/app/**/*-spec.js`. Read the count with the caveat below |
| `integration` | `stf local` boots against a RethinkDB service, fake devices round-trip through STF's own db layer, and the Playwright web UI suite passes without any device |
| `android` (matrix) | one leg per Android release from 5.0 to 16: boot an emulator, attach `stf local` to it, and drive it from the browser |
| `report` | aggregates everything into one sticky PR comment |

### The component tier counts more than it proves

karma reports 82 specs and the report says so, but that number is not coverage.
Of the 82 executable `it()` blocks in `res/app`, 3 assert something real, 33 are
`expect(1).toEqual(1)`, and 46 have an empty body with the assertion left
commented out, which is the unmodified AngularJS generator stub. The whole tier
runs in about 0.12s, which is the giveaway. They are upstream's specs and this
branch does not rewrite them, so the report line names the split instead:

```
82 specs, 0 failed, 0 errored (3 assert, 79 are upstream stubs)
```

`.github/scripts/count-assertions.js` computes that split at report time rather
than hardcoding it, so writing a real spec moves the number without anyone
having to remember to update it. Run it on its own to see the breakdown:

```bash
node .github/scripts/count-assertions.js
```

What the tier does still prove is worth keeping: every spec is compiled and run
against real AngularJS in a real headless Chrome, so a module that fails to load,
a broken `require` in `res/app`, or a directive that throws on compile fails the
job. That is a smoke test of the front end, not a behavioural one.

## The Android matrix

Legs come from `.github/android-matrix.json`. To add or change one, edit that
file only: the matrix is generated from it and the report uses the same file to
decide which legs were required to report, so the two cannot drift apart. API
values must be unique. The flip side of that is that deleting a leg also deletes
it from the required set, so a shrunk matrix still reports all green. `plan`
only rejects an empty `include` and duplicate API values, it does not enforce a
minimum.

Each leg walks these layers in order and records the result of each, so the
report names the layer that broke rather than showing one opaque cross.
`.github/scripts/checks.js` is where they are defined: the order, which ones
gate a leg, how a failure is worded and the report's legend all come from there,
so adding a layer is one edit rather than four.

1. `image` : a system image is actually published for that API level and arch
2. `emulator_boot` : the emulator reached `sys.boot_completed` and answers adb
3. `stf_device_present` : STF's provider registered the device
4. `stf_device_usable` : STF marked it present and ready, offered it as
   available, and handed control over
5. `screen_stream` : minicap frames reached the browser canvas and kept changing
6. `touch_roundtrip` : a browser tap and swipe showed up in `getevent` on the
   device itself, at the coordinates they were aimed at
7. `device_shell` : the dashboard shell widget ran a command on it
8. `playwright_ui` : the rest of the web UI suite

Notes that matter when changing the matrix:

- `default` (AOSP) is the smallest image and the only AOSP one published across
  the whole range. Every API from 21 to 36 has one, so the matrix has no gaps.
- API 21 (Android 5.0) is the oldest level that works. Android 4.1 to 4.4 were
  measured, not assumed; see below.
- The legs pass `profile: pixel_2` to the emulator action, which is a 1080x1920
  420dpi screen. Without a profile `avdmanager` builds a 320x640 160dpi display,
  which is smaller than the browser's device pane, so STF asks minicap for a
  virtual display larger than the real screen. Native minicap ignores that and
  streams at the real size, but the `app_process` grabber used above API 30 puts
  the unscaled capture in the top left of the larger frame, so the STF UI shows
  the device letterboxed with black to the right and below. The painted area
  measured exactly 320/435 of the pane in both axes, which is the ratio of the
  real size to the virtual one. With a display larger than the pane, minicap
  scales down instead and both grabbers agree: `1080x1920@478x850/0`.
- Everything below API 26 runs on the 32 bit `x86` image. API 21 is the first
  level with an `x86_64` image at all, and API 24's `x86_64` image never reaches
  `sys.boot_completed` on the current emulator binaries; it sat for the full 50
  minute step budget without booting. minicap and minitouch both ship `x86`
  prebuilts, so STF works fine on it.
- The device needs `adb root` before `stf local` starts, because minitouch has
  to open `/dev/input/event*` and the shell user cannot. Without it every
  gesture is silently dropped and the device otherwise looks healthy. Taking
  root before STF is watching matters too: `adb root` restarts adbd, and a
  transport flap while the provider is tracking leaves a stale device record.
- `@devicefarmer/minicap-prebuilt` only ships a native `minicap.so` up to
  `android-30`. Above that, `.github/scripts/android-leg.sh` sets
  `SCREEN_GRABBER=minicap-apk` so STF goes straight to the `app_process`
  grabber instead of failing the native attempt first.
- A leg whose system image is not published self-skips instead of failing, and
  the report says so. The probe fails open: if `sdkmanager` cannot be read at
  all the leg still runs, because a probe that fails closed would let the whole
  matrix self-skip and report green.

### Android 4.1 to 4.4 are parked, and it is not the emulator's fault

All four boot, adb answers, STF's provider registers the device, and
`playwright_ui` passes. They stop at `stf_device_present`, because the device
worker dies in a restart loop with `Setup had an error TimeoutError` before
anything is written to STF's devices table. Two different causes, both from
STF's own prebuilts rather than from CI:

- API 17, 18 and 19 (Android 4.2, 4.3, 4.4) die on minitouch:

  ```
  minitouch says: "CANNOT LINK EXECUTABLE: cannot locate symbol
  "__strncpy_chk2" referenced by "/data/local/tmp/minitouch""
  ```

  `__strncpy_chk2` is a bionic FORTIFY helper that only exists from API 21. The
  binary in `@devicefarmer/minitouch-prebuilt` 1.3.2 references it, so it cannot
  link on 4.x at all, and `minitouch-nopie` and the `x86_64` build reference it
  too. minicap is unaffected: it needs only `__stack_chk`, which is why the
  screen path was fine and only touch broke.

  This is a toolchain artefact, not a source change. 1.3.2 was built with Android
  clang 21; version 1.3.0 of the same package was built with clang 9 and does not
  reference the symbol. Pinning the dependency to 1.3.0 would probably bring 4.2
  to 4.4 back, but it downgrades the touch binary for every device, not just old
  ones, so it is a product decision rather than a CI one.

- API 16 (Android 4.1) has a second, independent blocker. STFService installs
  and gets its permission granted, then its agent dies immediately:

  ```
  java.lang.UnsupportedOperationException: Unsupported singleton
  android.hardware.display.DisplayManagerGlobal
    at jp.co.cyberagent.stf.util.InternalApi.getSingleton(InternalApi.java:90)
    at jp.co.cyberagent.stf.MinitouchAgent.getScreenSize(MinitouchAgent.java:78)
  ```

  `android.hardware.display.DisplayManagerGlobal` was added in API 17, so no
  amount of fixing minitouch reaches this one. It needs a rebuilt STFService.

For the record on the floor below that: the STFService APK shipped by
`@devicefarmer/stfservice-prebuilt` declares `minSdkVersion 16` (decoded from its
manifest, version 2.5.6, targetSdk 30) and STF only uses PIE binaries from sdk 16 up (`pie: sdk.level >= 16` in
`lib/units/device/support/abi.js`), so API 15 and API 10 cannot even install the
service, although they do have published x86 images that boot. API 20 is 4.4W
and only ever shipped for wearables.

### Minor-versioned levels need current cmdline-tools

API 36.1 and all three published API 37 levels, 37.0, 37.1 and 37.2, are in the
matrix. API 37 was parked for a while, and the cause turned out to be the CI
image rather than STF or the emulator.

`ubuntu-24.04` ships Android cmdline-tools 12.0, which cannot parse a dotted API
level. `avdmanager create avd --package 'system-images;android-37.1;...'` exits 0
and writes the correct `image.sysdir.1`, but sets `target=android-0` instead of
`target=android-37.1`. That mis-configures gfxstream, the guest is offered
`ReadColorBufferDma`, and `mapper.ranchu.so` aborts:

```
Abort message: 'Assertion failed: !rcEnc->featureInfo()->hasReadColorBufferDma'
  #03 /vendor/lib64/hw/mapper.ranchu.so  GoldfishMapper::readFromHost(cb_handle_t const&)
tid: RegionSampling  >>> /system/bin/surfaceflinger <<<  signal 6 (SIGABRT)
```

SurfaceFlinger then crashloops, `DisplayEventReceiver.nativeInit` fails with
`status=-32`, `DisplayManagerGlobal.getInstance()` throws, and STFService dies
reflecting on it. The symptom therefore reads as an STF or STFService bug and is
not one. Measured before and after, same images, same `-gpu swiftshader_indirect`:

| image | cmdline-tools 12.0 | cmdline-tools 23.0 |
|---|---|---|
| `android-37.0;google_apis` | 8 aborts, SF started 4x | 0 aborts, SF started once |
| `android-37.1;google_apis_ps16k` | 11 aborts, SF started 5x | 0 aborts, SF started once |
| `android-37.2;google_apis_ps16k` | 11 aborts, SF started 5x | 0 aborts, SF started once |

`.github/scripts/update-cmdline-tools.sh` replaces
`$ANDROID_HOME/cmdline-tools/latest` in place. It has to be in place:
android-emulator-runner puts that exact directory on `PATH` and invokes a bare
`avdmanager`, and `sdkmanager --install "cmdline-tools;latest"` cannot overwrite
the directory it is running from, so it silently installs to a sibling
`cmdline-tools/latest-2` that nothing then uses. The update is a no-op for the
integer levels: API 36 gets `target=android-36` under both 12.0 and 23.0.

On image paths, the AOSP repo stops at `android-36;default`, so neither 36.1 nor
any API 37 level has a `default` image. 36.1 and 37.0 publish a plain
`google_apis` one; from `37.1` on Google publishes only the 16 KB page size
variant, so those legs use `google_apis_ps16k`. Plain `android-37` does not
exist. No `playstore` variant is usable here, because they block `adb root`,
which minitouch needs to open `/dev/input`. `37.2` is additionally published only
on the `dev` SDK channel, which is why its leg carries `channel`/`channelId`;
`--channel` is cumulative, so the stable legs are unaffected. The 37.2 beta
images are deliberately left out: GA supersedes them, and Google prunes beta
images after GA, which would make the leg self-skip and report green with no
coverage.

Upstream: https://issuetracker.google.com/issues/546200928 (resolved) and
https://github.com/actions/runner-images/issues/14484 (open, so the update is
still needed on current images).

### Rotation control is dead on API 29 and up, and no check catches it

Measured across all 16 legs, not inferred. From API 29 onward each leg's
`logcat.txt` carries four hidden-API denials against the rotation entry points
plus one failed fallback, and API 21 to 28 carry none:

```
W/.cyberagent.st: Accessing hidden method
  Landroid/view/IWindowManager$Stub$Proxy;->freezeRotation(I)V
  (greylist-max-o, reflection, denied)
W/System.err: java.lang.NoSuchMethodException:
  android.view.IWindowManager$Stub$Proxy.getRotation []
  at jp.co.cyberagent.stf.compat.WindowManagerWrapper.getRotation(WindowManagerWrapper.java:66)
  at jp.co.cyberagent.stf.monitor.RotationMonitor.peek(RotationMonitor.java:54)
```

`getDefaultDisplayRotation`, `freezeRotation` and `thawRotation` are all on the
blocklist from API 29, and STFService's fallback to the older `getRotation` name
does not exist either, so `RotationMonitor` has no way to read rotation and STF's
rotate controls cannot set it. On API 28 the same reflection is allowed with a
greylist warning, which is why the split is exactly 28/29.

Two things follow, and both are deliberate:

- **No layer asserts rotation**, so all 16 legs are green while half of them
  cannot rotate. This is recorded rather than fixed because it needs a rebuilt
  STFService, exactly like the Android 4.1 and API 37 entries above. Adding a
  gating rotation check would turn 8 legs red for a product limitation this
  branch cannot fix, and adding a non-gating one would paint half the column red
  on every run without telling anyone anything new.
- **The leg logs cannot show it.** The exception is printed to `System.err`
  inside STFService on the device, so `stf-local.log` records 0 ERR and 0 FTL on
  every leg. `logcat.txt` in the leg's artifact is the only place it appears,
  which is the reason that file is collected.

## Running the tests locally

```bash
npm install                    # deps, bower components and the bundle
npm test                       # lint, stf -V, then the mocha specs
```

Or one tier at a time:

```bash
npm run lint
npm run test:unit
CHROME_BIN=$(which google-chrome) npm run test:component
```

`npm test` was `gulp test`, which is `gulp.parallel('lint',
'run:checkversion')`: it ran eslint and `stf -V` and nothing else, so the mocha
specs under `test/` existed but `npm test` never ran them and still passed. It
now runs that same gulp task and then the mocha specs, so it still needs no
browser and works anywhere, which is what CONTRIBUTING asks of it.

`test:component` is the karma tier. It needs a Chrome, which is what `CHROME_BIN`
is for, so CI runs it as its own job where a browser is guaranteed rather than
making `npm test` depend on one.

There is no committed `package-lock.json`: `.gitignore` excludes it, so CI uses
`npm install` and keys its dependency cache on `package.json` and `bower.json`.

Every job reads its Node version from `.nvmrc` (22.11.0), which is also what the
`Dockerfile` and `.semaphore/semaphore.yml` use, so CI tests the runtime the
project actually ships rather than a second version pinned in the workflow.

The npm publish job in `release.yml` is the exception: it pins Node 24, because
npm trusted publishing needs Node 22.14.0 or later and npm 11.5.1 or later, and
22.11.0 ships npm 10.x. The tarball's bundle is therefore built on a runtime no
test tier exercises. Nothing else in the release path needs it, so the rest
reads `.nvmrc` like every other job.

If you bump past Node 22, the karma tier needs an `overrides` entry for log4js.
karma 2.0.5 pulls log4js 2.11.0, whose layout formatter calls `util.isError` on
every log argument, and Node 23 removed it. The first line karma logs throws,
karma's `uncaughtException` handler logs the throw, log4js throws again inside
the handler, and the process dies with exit code 7 before any test runs. log4js
dropped that call in 3.0.6, so `"overrides": {"log4js": "^6.9.1"}` fixes it and
affects nothing outside karma's tree.

`phantomjs-prebuilt` and `karma-phantomjs-launcher` are gone from
`devDependencies`. PhantomJS has been unmaintained since 2018 and nothing here
uses it: `karma.conf.js` already defaulted to Chrome with the PhantomJS launcher
commented out. `.semaphore/semaphore.yml` currently has to run
`sed -i'' -e '/phantomjs/d' package.json` before `npm install`; with the
dependency gone that line is a no-op and can be dropped.

For the Playwright suite you need a running `stf local`:

```bash
docker run -d --name rethinkdb -p 28015:28015 rethinkdb:2.4.2
bash .github/scripts/start-stf.sh            # add a serial to limit it to one device
node .github/scripts/stf-devices.js list     # what STF thinks it has

cd test/playwright
npm install && npx playwright install chromium
npx playwright test ui.spec.js               # no device needed
STF_DEVICE_SERIAL=emulator-5554 npx playwright test
```

`device.spec.js` skips itself unless `STF_DEVICE_SERIAL` is set.

## The report

Every job writes a small JSON verdict and uploads it as an artifact; `report`
downloads them all and renders one table. Matrix legs cannot pass distinct
outputs to a downstream job (they overwrite each other), so artifacts are the
only mechanism that works here.

A job that dies before writing its verdict is reported as failed rather than
disappearing from the table, which is what `EXPECTED_TIERS` and
`EXPECTED_ANDROID_FILE` in the `report` job are for.

## Debugging a failed leg

Every leg uploads `android-logs-api-<api>-<target>` containing `stf local`'s
full stdout, `logcat`, `getprop`, `dumpsys window`, what STF had in its devices
table, and the Playwright report. Start there rather than with the job log.

Under `test-results/playwright/artifacts` there are two kinds of video, and they
answer different questions:

- `session/*.webm` is the browser, recorded for the whole device group whether it
  passed or not. It shows the STF web UI, so it tells you what the operator would
  have seen, including whether the device canvas ever painted a frame.
- `device-tap.mp4` and `device-swipe.mp4` are `screenrecord` on the device
  itself, running while the browser sends the gesture. They show what the device
  actually did, which is the difference between "STF sent the touch" and "the
  touch landed". Best effort: an image without a working encoder records nothing
  and the test says so in its log rather than failing.

The leg turns on `show_touches` before the tests for the sake of that second
recording. `screenrecord` only encodes what SurfaceFlinger repaints, and a tap on
the launcher wallpaper repaints nothing, so without it the tap video is a single
frame of a static screen with no duration. The swipe was always visible because
the app drawer animates.

Each touch test also attaches its raw `getevent` capture (`getevent-tap`,
`getevent-swipe`) to the Playwright report, so a passing touch check can be read
back as actual `ABS_MT_*` lines instead of being taken on trust. Each capture is
prefixed with what the raw lines cannot say about themselves:

```
aimed at: swipe from 0.5,0.75 to 0.5,0.25
device:   /dev/input/event2
axis max: x=32767 y=32767
y landed: 0.7501 0.6995 0.6499 ... 0.2999 0.2499
```

That header matters for more than convenience. The gesture is deterministic and
the touch axes are the same 0..32767 on every image, so the raw captures are
byte-identical across legs and bind to none of them; the device node and the
resolved fractions are what tie a capture to the leg that produced it.

Traces and screenshots are still failure only, since the trace viewer already
carries per action screenshots and traces are large.

## Releasing

Releasing takes two dispatches with a pull request between them.

1. Run `Prepare release` with the version as input, for example `3.8.0`. It
   bumps `package.json`, writes the `CHANGELOG.md` section from GitHub's
   generated notes, and pushes `release/v3.8.0`. It writes nothing to `master`.
2. Open the pull request it links to in the job summary, label it
   `ignore-for-release`, and merge it once the checks pass.
3. Run `Release` with the same version. It tags `v3.8.0`, publishes the GitHub
   release, then publishes to npm and pushes the Docker image.

The bump lands through a pull request because `master` is protected. A workflow
holding only `GITHUB_TOKEN` cannot push to it, and having the workflow open the
pull request itself would not help: a pull request opened with `GITHUB_TOKEN`
starts no workflow run, so it would arrive with no checks and could never
satisfy a required check.

The split is also why the two guards differ. `Prepare release` requires the
input to be greater than `package.json`, since it is about to do the bump.
`Release` requires it to be equal, since by then the bump has merged. `Release`
additionally refuses to run anywhere but the default branch: `release/v3.8.0`
satisfies the equality check by construction, so without that guard the
unmerged branch could be tagged and published.

`Release` reads the release body back out of `CHANGELOG.md` rather than
regenerating it. The changelog and the release then cannot drift, and a
correction made while reviewing the release pull request reaches both.

The publish jobs live in `release.yml` alongside the tag rather than in a
separate workflow keyed on the tag, because a tag pushed with `GITHUB_TOKEN`
does not start another workflow run. Jobs in the same run are not subject to
that.

Renaming `release.yml` breaks npm publishing. npm trusted publishing matches on
the exact workflow filename, so the name is part of the configuration held on
npmjs.com. `prepare-release.yml` publishes nothing and can be renamed freely.

Neither registry uses a stored credential:

- npm authenticates with a trusted publisher, configured on npmjs.com against
  this repository and `release.yml`. The job needs `id-token: write` and no
  `.npmrc`.
- Docker Hub authenticates with an OIDC connection created by an organization
  admin. `docker/login-action` picks it up from the `DOCKERHUB_OIDC_CONNECTIONID`
  repository variable.

`.semaphore/` still builds and tests, but no longer publishes. Both systems
publishing the same tag would race, and only one can win.

To keep a pull request out of the release notes and the changelog, label it
`ignore-for-release`. The release pull request itself should carry that label,
or the next release's notes open with the previous version bump.
