#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: apt-install.sh <package> [package...]" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive

# The runner image already ships a lot of this, and apt is the least reliable
# thing in the job, so find out whether there is anything to do before touching
# the network at all. The runtime legs usually ask for one package that is
# missing and one that is not.
missing=()
for pkg in "$@"; do
  if [ "$(dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null)" = 'installed' ]; then
    echo "apt-install: ${pkg} is already installed"
  else
    missing+=("$pkg")
  fi
done

if [ "${#missing[@]}" -eq 0 ]; then
  echo "apt-install: nothing to install"
  exit 0
fi

echo "apt-install: installing ${missing[*]}"

# unattended-upgrades holds the dpkg lock on a freshly booted runner.
sudo systemctl stop unattended-upgrades.service 2>/dev/null || true

if [ -f /etc/apt/apt-mirrors.txt ]; then
  echo "apt-install: apt is using this mirror list:"
  sed 's/^/  /' /etc/apt/apt-mirrors.txt
fi

# Acquire::Retries is 1 on purpose. apt walks every suite against every mirror
# in /etc/apt/apt-mirrors.txt, so a mirror that accepts the connection and then
# stalls costs retries * suites * timeout. At Retries=3 that was 11m37s in run
# 34600228545, which ran the 12 minute step budget out before the install below
# was even reached and reported the leg as an emulator boot failure. Retrying
# is done deliberately further down, around the install, which is the part that
# actually has to succeed.
APT_OPTS=(
  -o DPkg::Lock::Timeout=180
  -o Acquire::Retries=1
  -o Acquire::http::Timeout=15
  -o Acquire::https::Timeout=15
)

UPDATE_TIMEOUT="${APT_UPDATE_TIMEOUT:-120}"

# A partial index refresh is usually enough to install from, and the indexes
# baked into the image are days old at worst, so cap this instead of letting a
# dead mirror eat the step. Run timeout under sudo so it can signal apt-get.
apt_update() {
  if sudo timeout "$UPDATE_TIMEOUT" apt-get "${APT_OPTS[@]}" update; then
    return 0
  fi
  echo "::warning::apt-get update did not finish within ${UPDATE_TIMEOUT}s, installing from the indexes already on the image"
  return 0
}

apt_update

# A stale index is the one failure a plain retry cannot clear, because the
# version apt resolved has already been superseded on the mirror and every
# attempt 404s the same way. Refresh between the tries so the second one is
# working from a different answer than the first.
attempts=3
attempt=1
until sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "${missing[@]}"; do
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::apt-get install failed after ${attempt} attempts: ${missing[*]}" >&2
    exit 1
  fi
  echo "::warning::apt-get install attempt ${attempt} of ${attempts} failed, refreshing the indexes and retrying"
  sleep $((attempt * 10))
  apt_update
  attempt=$((attempt + 1))
done
