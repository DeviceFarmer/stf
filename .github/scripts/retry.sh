#!/usr/bin/env bash
#
# Run a command until it succeeds, up to <attempts> times, backing off between
# the tries.
#
# Every network-dependent setup step in this workflow has been seen to fail
# transiently on a hosted runner: apt mirrors refuse the connection, the
# Playwright CDN hands back a 5xx. None of them are the thing under test, so a
# retry is the difference between a red run and a slightly slower one.
#
# usage: retry.sh <attempts> <command> [args...]
#
set -uo pipefail

attempts="${1:-}"
case "$attempts" in
  '' | *[!0-9]*)
    echo "usage: retry.sh <attempts> <command> [args...]" >&2
    exit 2
    ;;
esac
shift

if [ "$#" -eq 0 ]; then
  echo "usage: retry.sh <attempts> <command> [args...]" >&2
  exit 2
fi

status=1
delay=5

for attempt in $(seq 1 "$attempts"); do
  # Read the status in the else branch. After a plain `if cmd; then ...; fi`
  # whose condition failed, $? is the status of the `if` itself, which is 0,
  # and the whole wrapper would then exit 0 on a command that never succeeded.
  if "$@"; then
    if [ "$attempt" -gt 1 ]; then
      echo "retry.sh: succeeded on attempt ${attempt} of ${attempts}"
    fi
    exit 0
  else
    status=$?
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::attempt ${attempt} of ${attempts} exited ${status}, retrying in ${delay}s: $*"
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo "::error::all ${attempts} attempts failed (exit ${status}): $*" >&2
exit "$status"
