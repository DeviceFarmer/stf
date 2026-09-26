#!/usr/bin/env bash
#
# Install the Transifex CLI (tx) into ~/.local/bin and put it on PATH.
#
# The version and checksum are pinned so a new release cannot change what the
# translation workflow runs. To upgrade, take both from the release's
# checksums.txt at https://github.com/transifex/cli/releases.
#
set -euo pipefail

TX_VERSION=v1.6.17
TX_SHA256=002dec5b9e71248a7e6a0808118e9da940205828d5a33ce88e04bb57a967164d

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

bash "$(dirname "$0")/retry.sh" 3 curl -sSfL -o "$dir/tx.tar.gz" \
  "https://github.com/transifex/cli/releases/download/${TX_VERSION}/tx-linux-amd64.tar.gz"
echo "${TX_SHA256}  $dir/tx.tar.gz" | sha256sum -c -

mkdir -p "$HOME/.local/bin"
tar -xzf "$dir/tx.tar.gz" -C "$dir" tx
install -m 0755 "$dir/tx" "$HOME/.local/bin/tx"
echo "$HOME/.local/bin" >> "${GITHUB_PATH:-/dev/null}"
"$HOME/.local/bin/tx" --version
