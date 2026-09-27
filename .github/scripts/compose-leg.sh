set -euo pipefail

HOST_SERIAL="emulator-${EMULATOR_PORT:-5554}"
export STF_DEVICE_SERIAL=host.docker.internal:15555
export STF_ADB_KEYS="${STF_ADB_KEYS:-$HOME/.android}"

mkdir -p test-results/compose

collect_logs() {
  timeout 20 adb -s "$HOST_SERIAL" logcat -d -v time > test-results/compose/logcat.txt 2>&1 || true
  timeout 20 adb -s "$HOST_SERIAL" shell getprop > test-results/compose/getprop.txt 2>&1 || true
  if [ -n "${RELAY_PID:-}" ]; then
    kill "$RELAY_PID" 2>/dev/null || true
    wait "$RELAY_PID" 2>/dev/null || true
  fi
}
trap collect_logs EXIT

# `adb root` restarts adbd, so the transport drops and comes back a moment
# later: the root call itself, the wait-for-device, the getprop and the id check
# can each fail transiently with "adb: unable to connect for root: closed" or an
# empty shell reply. Retry the whole block as a unit rather than any single line
# - re-running `adb root` is a no-op that exits 0 once adbd is already root.
# Worst case is 10 * (20s wait + 3s sleep), which still leaves room in the
# step budget after the AVD boot and the compose --wait timeouts.
# The values are captured into variables instead of piped into `grep -q`,
# because `grep -q` exits at the first match and can SIGPIPE the adb writer,
# which `set -o pipefail` then reports as a failure of a check that passed.
rooted=no
boot_completed=""
whoami_on_device=""
for attempt in $(seq 1 10); do
  adb -s "$HOST_SERIAL" root 2>&1 | sed 's/^/  /' || true
  timeout 20 adb -s "$HOST_SERIAL" wait-for-device || true
  boot_completed="$(adb -s "$HOST_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n' || true)"
  whoami_on_device="$(adb -s "$HOST_SERIAL" shell id 2>/dev/null | tr -d '\r\n' || true)"
  if [ "$boot_completed" = 1 ]; then
    case "$whoami_on_device" in
      uid=0* | root)
        rooted=yes
        break
        ;;
    esac
  fi
  sleep 3
done

# Unlike the Android leg, which only warns, the Compose leg cannot run without
# root: minitouch has to open /dev/input/event* for writing or every touch test
# silently does nothing. Fail loudly, and print the last thing we saw so the
# logcat and getprop dumps taken by the EXIT trap have something to pair with.
if [ "$rooted" != yes ]; then
  echo "::error::adb root or boot never completed on $HOST_SERIAL after $attempt attempts" \
    "(sys.boot_completed=${boot_completed:-unset}, adb shell runs as ${whoami_on_device:-unknown})"
  exit 1
fi
echo "adb shell runs as: $whoami_on_device"

adb -s "$HOST_SERIAL" shell input keyevent 82
adb -s "$HOST_SERIAL" shell wm dismiss-keyguard
adb -s "$HOST_SERIAL" shell settings put system show_touches 1

socat TCP-LISTEN:15555,bind=0.0.0.0,reuseaddr,fork \
  "TCP:127.0.0.1:$(( ${EMULATOR_PORT:-5554} + 1 ))" \
  > test-results/compose/adb-relay.log 2>&1 &
RELAY_PID=$!

docker compose up -d --pull never --wait --wait-timeout 120 rethinkdb adb
# No adbd restart happens here - root is already established host-side - but the
# container reaches the emulator over the socat relay, and `adb connect`
# returning OK only means the TCP connect succeeded, not that the forwarded
# transport is ready to run a shell. Fewer attempts are enough for that, and the
# same capture-instead-of-`grep -q` rule applies for the pipefail reason above.
in_container_id=""
for attempt in $(seq 1 5); do
  docker compose exec -T adb adb connect "$STF_DEVICE_SERIAL" || true
  timeout 30 docker compose exec -T adb adb -s "$STF_DEVICE_SERIAL" wait-for-device || true
  in_container_id="$(docker compose exec -T adb adb -s "$STF_DEVICE_SERIAL" shell id 2>/dev/null | tr -d '\r\n' || true)"
  case "$in_container_id" in
    uid=0* | root)
      break
      ;;
  esac
  sleep 3
done
case "$in_container_id" in
  uid=0* | root) ;;
  *)
    echo "::error::the adb container cannot get a root shell on $STF_DEVICE_SERIAL" \
      "after $attempt attempts (adb shell runs as ${in_container_id:-unknown})"
    exit 1
    ;;
esac
docker compose exec -T adb adb devices -l > test-results/compose/adb-devices.txt
docker compose up -d --pull never --wait --wait-timeout 240
docker compose cp provider:/app/node_modules/@devicefarmer/stfservice-prebuilt/prebuilt/noarch/STFService.apk \
  test-results/compose/STFService.apk

check_services() {
  docker compose ps --all --quiet | xargs docker inspect > test-results/compose/services.json
  node .github/scripts/compose-services.mts test-results/compose/services.json
}

check_services

(
  cd test/playwright
  ADB_SERVER_SOCKET=tcp:127.0.0.1:15037 STF_URL=http://127.0.0.1:7100 STF_COMPOSE=1 \
    npx playwright test ui.spec.ts device.spec.ts compose.spec.ts --retries=0
)

check_services

node .github/scripts/playwright-checks.mts \
  test-results/playwright/report.json test-results/compose/playwright-checks.json

node -e '
  const report = require("./test-results/compose/playwright-checks.json")
  const required = ["stf_device_present", "stf_device_usable", "screen_stream",
    "touch_roundtrip", "device_shell", "playwright_ui", "compose_api", "compose_storage"]
  if (!report.total || report.skipped || report.suite_errors || report.failed.length ||
      required.some(key => report.checks[key] !== "pass")) {
    throw new Error("Compose coverage is incomplete: " + JSON.stringify(report))
  }
'
