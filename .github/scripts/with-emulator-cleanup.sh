set -uo pipefail

cleanup() {
  status=$?
  trap - EXIT
  if ! node .github/scripts/stop-emulator.mts; then
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

bash "$@"
