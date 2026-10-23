#!/usr/bin/env bash
#
# Install the SDK packages android-emulator-runner would otherwise download
# itself, one attempt per call. Run it under retry.sh.
#
# The action fetches them with bare sdkmanager calls and no retry, so a
# truncated archive from dl.google.com ("Error on ZipFile unknown archive")
# fails the emulator step before an emulator ever starts, and the leg retry
# then hits the same thing. Once the packages are here, the action's own
# installs are no-ops.
#
# The package list mirrors what v2.38.0 installs. build-tools;37.0.0 is the
# action's own pin, so bump it together with the action.
#
# usage: install-android-sdk.sh <api> <target> <arch> <channel id>
#
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: install-android-sdk.sh <api> <target> <arch> <channel id>" >&2
  exit 2
fi

api="$1"
target="$2"
arch="$3"
channel="$4"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "::error::neither ANDROID_HOME nor ANDROID_SDK_ROOT is set"; exit 1; }
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKMANAGER" ]; then
  echo "::warning::no sdkmanager found, leaving the installs to the emulator action"
  exit 0
fi

# Don't let a later try pick up a partial download from a failed one.
rm -rf "$SDK/.temp" "$SDK/.downloadIntermediates"

# yes exits on SIGPIPE once sdkmanager stops reading, which pipefail would
# otherwise report as a failure.
yes | "$SDKMANAGER" --licenses > /dev/null || true

"$SDKMANAGER" --install 'build-tools;37.0.0' platform-tools "platforms;android-${api}"
"$SDKMANAGER" --install emulator --channel="$channel"
"$SDKMANAGER" --install "system-images;android-${api};${target};${arch}" --channel="$channel"
