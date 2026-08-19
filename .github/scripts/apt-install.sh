#!/usr/bin/env bash
#
# Install apt packages on a GitHub runner without waiting on a dead mirror.
#
# The GitHub runner image points apt at azure.archive.ubuntu.com, which
# intermittently answers nothing at all:
#
#   Ign:2 http://azure.archive.ubuntu.com/ubuntu noble InRelease
#   Ign:3 http://azure.archive.ubuntu.com/ubuntu noble-updates InRelease
#   ...
#
# apt retries that for minutes before falling back to archive.ubuntu.com, which
# looks like a hung job rather than a slow one. Repoint at the canonical archive
# up front and give apt hard timeouts so a bad mirror fails fast.
#
# usage: apt-install.sh <package> [package...]
#
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: apt-install.sh <package> [package...]" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive

# unattended-upgrades holds the dpkg lock on a freshly booted runner.
sudo systemctl stop unattended-upgrades.service 2>/dev/null || true

# The runner image does not name the mirror in the sources files at all. They
# say `mirror+file:/etc/apt/apt-mirrors.txt`, and that file lists azure first,
# so editing the sources achieves nothing. Replace the mirror list itself.
if [ -f /etc/apt/apt-mirrors.txt ]; then
  echo "mirror list was:"
  sed 's/^/  /' /etc/apt/apt-mirrors.txt
  printf 'http://archive.ubuntu.com/ubuntu/\n' \
    | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi

# Belt and braces for images that do name the mirror directly. Noble uses the
# deb822 .sources format; older images use .list.
for f in /etc/apt/sources.list \
         /etc/apt/sources.list.d/*.sources \
         /etc/apt/sources.list.d/*.list; do
  [ -f "$f" ] || continue
  sudo sed -i \
    's|https\?://azure\.archive\.ubuntu\.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' \
    "$f"
done

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
