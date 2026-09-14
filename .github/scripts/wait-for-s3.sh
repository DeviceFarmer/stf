#!/usr/bin/env bash
#
# Block until an S3 endpoint actually answers an S3 request. SeaweedFS opens
# its port several seconds before the gateway can serve, so a port check
# passes and the first request still dies with ECONNRESET.
#
# usage: wait-for-s3.sh <endpoint> [timeout-seconds]
set -euo pipefail

ENDPOINT="${1:?usage: wait-for-s3.sh <endpoint> [timeout]}"
TIMEOUT="${2:-90}"

waited=0
while [ "$waited" -lt "$TIMEOUT" ]; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$ENDPOINT/" 2>/dev/null || echo 000)
  case "$code" in
    200|403|404)
      echo "s3 endpoint $ENDPOINT answering ($code) after ${waited}s"
      exit 0
      ;;
  esac
  sleep 2
  waited=$((waited + 2))
done

echo "::error::s3 endpoint $ENDPOINT never answered within ${TIMEOUT}s"
exit 1
