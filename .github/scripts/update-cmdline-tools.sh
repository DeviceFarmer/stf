#!/usr/bin/env bash
#
# ubuntu-24.04 ships Android cmdline-tools 12.0, which cannot parse a dotted API
# level. avdmanager then writes `target=android-0` into the AVD instead of
# `target=android-37.1`, which mis-configures gfxstream: the guest is offered
# ReadColorBufferDma and mapper.ranchu SIGABRTs, taking SurfaceFlinger with it.
# See https://issuetracker.google.com/issues/546200928 and
# https://github.com/actions/runner-images/issues/14484.
#
# `latest` is replaced in place on purpose. android-emulator-runner puts
# $ANDROID_HOME/cmdline-tools/latest on PATH and invokes a bare `avdmanager`, so
# the sibling `latest-2` that `sdkmanager --install "cmdline-tools;latest"`
# creates (it cannot overwrite the directory it is running from) would be
# ignored and the AVD would still be built by the old tools.
#
# Build 16111833 is revision 23, so the pinned build and the floor below agree.
#
# This is a workaround with two ways out, and it should be deleted on whichever
# lands first:
#   - ReactiveCircus/android-emulator-runner#494 gates the action's own
#     cmdline-tools install on Pkg.Revision instead of only installing when the
#     directory is absent, which removes the need for this script entirely.
#   - actions/runner-images#14484 ships a current cmdline-tools in the image, at
#     which point the revision check below makes this a no-op on its own.
#
set -euo pipefail

BUILD=16111833
MIN_REVISION=23
CACHE="${CMDLINE_TOOLS_CACHE:-$HOME/.cache/android-cmdline-tools}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "::error::neither ANDROID_HOME nor ANDROID_SDK_ROOT is set"; exit 1; }
DEST="$SDK/cmdline-tools/latest"

revision() {
  sed -n 's/^Pkg.Revision=\([0-9]*\).*/\1/p' "$1/source.properties" 2>/dev/null
}

present="$(revision "$DEST")"
echo "cmdline-tools present: ${present:-none}, required: $MIN_REVISION"

if [ -n "$present" ] && [ "$present" -ge "$MIN_REVISION" ]; then
  echo "already new enough, nothing to do"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# actions/cache restores $CACHE, so the archive is fetched once per build id and
# every later leg copies from disk. Copy rather than move, or the first leg
# empties the cache and there is nothing to save.
if [ ! -x "$CACHE/cmdline-tools/bin/sdkmanager" ]; then
  echo "cache miss, downloading build $BUILD"
  curl -fsSL --retry 3 --retry-delay 5 -o "$work/ct.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-${BUILD}_latest.zip"
  rm -rf "$CACHE"
  mkdir -p "$CACHE"
  unzip -q "$work/ct.zip" -d "$CACHE"
else
  echo "cache hit for build $BUILD"
fi

mkdir -p "$SDK/cmdline-tools"
rm -rf "$DEST"
cp -a "$CACHE/cmdline-tools" "$DEST"

echo "cmdline-tools installed: $(revision "$DEST")"

# Revision 23 needs JDK 17 or newer and says so on stderr only, so a discarded
# stream here turns an actionable error into an empty package listing later.
if ! "$DEST/bin/avdmanager" list target > /dev/null 2>"$work/err"; then
  echo "::error::avdmanager is not usable after the update"
  head -5 "$work/err"
  exit 1
fi
