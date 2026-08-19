#!/usr/bin/env bash
#
# Block until a TCP port on localhost accepts a connection.
#
# usage: wait-for-port.sh <port> [timeoutSeconds] [label]
#
# start-stf.sh has its own waiter on purpose: it also watches the stf pid, so it
# can say "stf died" instead of timing out. This one knows nothing but the port.
#
set -uo pipefail

PORT="${1:?usage: wait-for-port.sh <port> [timeoutSeconds] [label]}"
TIMEOUT="${2:-60}"
LABEL="${3:-port $PORT}"

for i in $(seq 1 "$TIMEOUT"); do
  if (echo > "/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    echo "$LABEL ready after ${i}s"
    exit 0
  fi
  sleep 1
done

echo "::error::$LABEL never opened $PORT"
exit 1
