#!/usr/bin/env bash
#
# One Android matrix leg. Runs inside reactivecircus/android-emulator-runner,
# so an emulator is already booting when we get here.
#
# Walks the layers in order and records each one into $CHECKS_FILE, so the PR
# report can name the layer that broke instead of showing one opaque red cross:
#
#   emulator_boot -> stf_device_present -> stf_device_usable
#     -> screen_stream / touch_roundtrip / device_shell / playwright_ui
#
# Never exits non-zero for a test failure. The verdict is $CHECKS_FILE; the
# workflow decides pass/fail from that.
#
set -uo pipefail

CHECKS_FILE="${CHECKS_FILE:-checks.json}"
LOG_DIR="${STF_LOG_DIR:-stf-logs}"
SERIAL="${STF_DEVICE_SERIAL:-emulator-${EMULATOR_PORT:-5554}}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-720}"
STF_WAIT="${STF_WAIT:-420}"

export CHECKS_FILE LOG_DIR SERIAL
mkdir -p "$LOG_DIR"

set_check() {
  CHECK_KEY="$1" CHECK_VALUE="$2" node -e '
    var fs = require("fs")
    var path = process.env.CHECKS_FILE
    var checks = {}
    try {
      checks = JSON.parse(fs.readFileSync(path, "utf8"))
    }
    catch (e) {
      checks = {}
    }
    checks[process.env.CHECK_KEY] = process.env.CHECK_VALUE
    fs.writeFileSync(path, JSON.stringify(checks, null, 2))
  '
  echo "check ${1} = ${2}"
}

note() {
  echo ""
  echo "=== $* ==="
}

collect_logs() {
  note "collecting diagnostics"
  {
    adb devices -l
    echo "--- getprop ---"
    adb -s "$SERIAL" shell getprop
  } > "$LOG_DIR/device-props.txt" 2>&1 || true

  adb -s "$SERIAL" logcat -d -v time > "$LOG_DIR/logcat.txt" 2>&1 || true
  adb -s "$SERIAL" shell ls -l /data/local/tmp \
    > "$LOG_DIR/device-tmp.txt" 2>&1 || true
  adb -s "$SERIAL" shell dumpsys window \
    > "$LOG_DIR/dumpsys-window.txt" 2>&1 || true

  if [ -f "$LOG_DIR/stf.pid" ]; then
    kill "$(cat "$LOG_DIR/stf.pid")" 2>/dev/null || true
  fi

  echo "checks: $(cat "$CHECKS_FILE" 2>/dev/null)"
}
trap collect_logs EXIT

# Anything we do not reach stays "skip". `image` seeds "pass" instead: reaching
# this script proves the image exists, and ci.yml records the unpublished case.
node .github/scripts/checks.js seed "$CHECKS_FILE"

note "waiting for $SERIAL to finish booting"
adb -s "$SERIAL" wait-for-device
waited=0
booted=no
while [ "$waited" -lt "$BOOT_TIMEOUT" ]; do
  if [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ]; then
    booted=yes
    break
  fi
  sleep 5
  waited=$((waited + 5))
done

if [ "$booted" != "yes" ]; then
  echo "::error::$SERIAL never reported sys.boot_completed"
  set_check emulator_boot fail
  exit 0
fi

# boot_completed can fire before the input service exists, which is a known
# emulator race, so make sure adb really answers before handing it to STF.
if ! adb -s "$SERIAL" shell echo adb-ok | grep -q adb-ok; then
  echo "::error::$SERIAL booted but adb shell does not answer"
  set_check emulator_boot fail
  exit 0
fi

adb -s "$SERIAL" shell input keyevent 82 || true
adb -s "$SERIAL" shell wm dismiss-keyguard || true

SDK="$(adb -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r\n')"
ABI="$(adb -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r\n')"
echo "sdk level: $SDK"
echo "abi:       $ABI"

# @devicefarmer/minicap-prebuilt only ships a native minicap.so up to
# android-30, so above that go straight to the app_process grabber instead of
# letting STF fail the native attempt first.
if [ -n "$SDK" ] && [ "$SDK" -gt 30 ] 2>/dev/null; then
  export SCREEN_GRABBER=minicap-apk
  echo "using the minicap apk grabber (no native lib for android-$SDK)"
fi

set_check emulator_boot pass

# minitouch has to open /dev/input/event* for writing, which the shell user
# cannot do on these images ("Unable to open device /dev/input/eventN for
# inspection open: Permission denied"), so touch silently does nothing without
# this. Do it before STF starts watching adb: `adb root` restarts adbd, and a
# transport flap while the provider is tracking leaves STF holding a stale
# device record it never reaps.
note "getting adb root so minitouch can open /dev/input"
adb -s "$SERIAL" root 2>&1 | sed 's/^/  /' || true

# `id -un` is coreutils only. The toolbox `id` on the old images takes no
# arguments and prints "uid=0(root) gid=0(root)", so match on that instead or
# every pre-24 leg reports a root failure it does not have.
whoami_on_device=""
rooted=no
for attempt in $(seq 1 20); do
  adb -s "$SERIAL" wait-for-device
  whoami_on_device="$(adb -s "$SERIAL" shell id 2>/dev/null | tr -d '\r\n')"
  case "$whoami_on_device" in
    uid=0* | root)
      rooted=yes
      break
      ;;
  esac
  sleep 2
done
echo "  adb shell runs as: ${whoami_on_device:-unknown}"
if [ "$rooted" != "yes" ]; then
  echo "::warning::adb is not root on $SERIAL, minitouch will not be able to open /dev/input and touch will fail"
fi

# Without this the tap recording is a single frame of a static launcher, because
# screenrecord only encodes what SurfaceFlinger repaints and a tap on the
# wallpaper repaints nothing. show_touches paints the touch indicator, which
# makes the gesture visible in the video instead of only in getevent.
note "turning on show_touches so gestures are visible in the recording"
adb -s "$SERIAL" shell settings put system show_touches 1 2>&1 | sed 's/^/  /' || \
  echo "  could not set show_touches, the device recording will show less"

note "starting stf local against $SERIAL"
if ! bash .github/scripts/start-stf.sh "$SERIAL"; then
  echo "::error::stf local did not come up"
  exit 0
fi

note "waiting for STF to register the device"
if node .github/scripts/stf-devices.js wait-count 1 "$STF_WAIT"; then
  set_check stf_device_present pass
else
  echo "::error::STF never registered $SERIAL"
  set_check stf_device_present fail
  exit 0
fi

note "waiting for STF to mark the device present and ready"
if node .github/scripts/stf-devices.js wait-ready "$SERIAL" "$STF_WAIT"; then
  set_check stf_device_usable pass
else
  echo "::error::$SERIAL never became present+ready in STF"
  set_check stf_device_usable fail
  # Keep going: Playwright's failure output explains why far better than this.
fi

node .github/scripts/stf-devices.js list > "$LOG_DIR/stf-devices.json" \
  2> "$LOG_DIR/stf-devices.err" || true

note "running the Playwright suite against $SERIAL"
(
  cd test/playwright
  STF_DEVICE_SERIAL="$SERIAL" \
  STF_URL="http://${STF_PUBLIC_IP:-127.0.0.1}:7100" \
  npx playwright test
) || echo "::warning::playwright reported failures"

note "merging Playwright results"
node .github/scripts/playwright-checks.js \
  test-results/playwright/report.json \
  "$LOG_DIR/playwright-checks.json" || true

node .github/scripts/merge-checks.js \
  "$CHECKS_FILE" "$LOG_DIR/playwright-checks.json"

exit 0
