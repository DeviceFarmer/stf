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

adb -s "$HOST_SERIAL" root
timeout 60 adb -s "$HOST_SERIAL" wait-for-device
test "$(adb -s "$HOST_SERIAL" shell getprop sys.boot_completed | tr -d '\r\n')" = 1
adb -s "$HOST_SERIAL" shell id | grep -q 'uid=0'
adb -s "$HOST_SERIAL" shell input keyevent 82
adb -s "$HOST_SERIAL" shell wm dismiss-keyguard
adb -s "$HOST_SERIAL" shell settings put system show_touches 1

socat TCP-LISTEN:15555,bind=0.0.0.0,reuseaddr,fork \
  "TCP:127.0.0.1:$(( ${EMULATOR_PORT:-5554} + 1 ))" \
  > test-results/compose/adb-relay.log 2>&1 &
RELAY_PID=$!

docker compose up -d --pull never --wait --wait-timeout 120 rethinkdb adb
docker compose exec -T adb adb connect "$STF_DEVICE_SERIAL"
timeout 60 docker compose exec -T adb adb -s "$STF_DEVICE_SERIAL" wait-for-device
docker compose exec -T adb adb -s "$STF_DEVICE_SERIAL" shell id | grep -q 'uid=0'
docker compose exec -T adb adb devices -l > test-results/compose/adb-devices.txt
docker compose up -d --pull never --wait --wait-timeout 240
docker compose cp provider:/app/node_modules/@devicefarmer/stfservice-prebuilt/prebuilt/noarch/STFService.apk \
  test-results/compose/STFService.apk

check_services() {
  docker compose ps --all --quiet | xargs docker inspect > test-results/compose/services.json
  node .github/scripts/compose-services.js test-results/compose/services.json
}

check_services

(
  cd test/playwright
  ADB_SERVER_SOCKET=tcp:127.0.0.1:15037 STF_URL=http://127.0.0.1:7100 STF_COMPOSE=1 \
    npx playwright test ui.spec.js device.spec.js compose.spec.js --retries=0
)

check_services

node .github/scripts/playwright-checks.js \
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
