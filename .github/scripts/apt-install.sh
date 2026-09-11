#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: apt-install.sh <package> [package...]" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive

# unattended-upgrades holds the dpkg lock on a freshly booted runner.
sudo systemctl stop unattended-upgrades.service 2>/dev/null || true

if [ -f /etc/apt/apt-mirrors.txt ]; then
  echo "apt-install: apt is using this mirror list:"
  sed 's/^/  /' /etc/apt/apt-mirrors.txt
fi

APT_OPTS=(
  -o DPkg::Lock::Timeout=180
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=20
  -o Acquire::https::Timeout=20
)

# A partial index refresh is usually enough to install from, so do not let a
# flaky mirror fail the job here. The install below is what has to succeed.
sudo apt-get "${APT_OPTS[@]}" update || echo "::warning::apt-get update did not complete cleanly, trying the install anyway"

sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "$@"
