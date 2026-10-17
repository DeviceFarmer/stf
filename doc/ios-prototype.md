# Linux iOS prototype

This is the first hardware feasibility step for adding iOS to STF.
It runs as a separate, single-device service on a Linux USB host. The
[STF provider](ios-provider.md) registers the phone and adds browser controls
and signed IPA installation. Appium Grid is not connected yet.
For a complete local STF deployment, use the [Compose/native quick start](../docker/ios/README.md).
The prototype owns one WDA session; do not run another Appium/WDA controller
against the same phone while using it.

## What is implemented

- Explicit device selection by UDID; no fallback to the first connected phone.
- A check for an existing go-ios tunnel, developer image mounting, and startup of
  an already installed and signed WebDriverAgent (WDA).
- Loopback USB forwarding with `iproxy`, a local authenticated HTTP API,
  screenshots, an MJPEG stream, taps, swipes, text entry, Home and app activation.
- Serialized input, retries after USB/WDA failures, and cleanup of processes and
  the session owned by the prototype. Commands queued before a reconnect are
  discarded rather than replayed on the new session.
- A read-only `--doctor` command that reports missing tools, connected devices,
  pairing access and a tunnel for a selected phone.

## Requirements and verified sources

Start with a real iPhone running iOS 18 or later, Developer Mode and UI Automation
enabled, a trusted USB connection to the Linux host, and a valid development-signed WDA.
An ordinary unsigned `.ipa` cannot be used as the runner.

| Dependency or behavior | Source checked for this prototype |
| --- | --- |
| Node.js 22.18+ or 24+; no npm dependencies needed for this service | `package.json`, native TypeScript `.mts` entry points |
| go-ios CLI syntax | [go-ios v1.3.2 main.go](https://github.com/danielpaulus/go-ios/blob/v1.3.2/main.go) |
| WDA runner arguments and lifetime | [runWDACommand](https://github.com/danielpaulus/go-ios/blob/v1.3.2/cmd_device_testing.go) |
| iOS 27 Cryptex developer image support | [pymobiledevice3 v11.32.0 image mounter](https://github.com/doronz88/pymobiledevice3/blob/v11.32.0/pymobiledevice3/services/mobile_image_mounter.py) |
| Explicit RSD endpoint from the existing kernel tunnel | [pymobiledevice3 CLI](https://github.com/doronz88/pymobiledevice3/blob/v11.32.0/pymobiledevice3/cli/cli_common.py), [go-ios tunnel fields](https://github.com/danielpaulus/go-ios/blob/v1.3.2/ios/tunnel/tunnel.go) |
| Explicit loopback and USB-only forwarding | [iproxy](https://github.com/libimobiledevice/libusbmuxd/blob/master/tools/iproxy.c) |
| Separate Developer Mode and UI Automation switches | [Appium device preparation](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/device-setup.md#required-settings) |
| Linux support in the later Appium integration | [Non-macOS hosts](https://appium.github.io/appium-xcuitest-driver/12.11/guides/non-macos-hosts/) |

The go-ios commands were initially checked against the **v1.3.2 source** and
subsequently exercised on the [three-iPhone Linux fleet](ios-fleet-validation-2026-10-16.md).
Install that release using the upstream installation
instructions; verify the installed executable with `ios version`.
The runner's full installed bundle identifier and `.xctest` name must match the
signed artifact; the prototype deliberately has no guessed bundle ID default.

On a Debian/Ubuntu Linux host, `usbmuxd`, `libusbmuxd-tools` (for `iproxy`) and
`libimobiledevice-utils` are useful host packages. USB must reach that host;
when using Proxmox, pass the phone through to the selected Linux VM first.

### Verified iOS versions

The hardware trial used iPhone 13 Pro/iOS 26.7.1, iPhone 14 Plus/iOS 27.0.1
and iPhone 16 Plus/iOS 27.0.1 on a Linux VM with USB passthrough. The default
installation path is the [local Compose/native launcher](../docker/ios/README.md).
The host commands below remain useful for diagnostics and manual integration.

iOS 27 uses a Cryptex developer image path implemented by pymobiledevice3
v11.32.0. The checked go-ios v1.3.2 image mounter uses the earlier personalized
image path. For this trial, install pymobiledevice3 in a private virtual
environment and select it explicitly in both doctor and service launch:

```sh
python3 -m venv ~/.local/share/stf-ios-venv
~/.local/share/stf-ios-venv/bin/python -m pip install 'pymobiledevice3==11.32.0'
~/.local/share/stf-ios-venv/bin/pymobiledevice3 version
```

The prototype reads the selected phone's `address` and `rsdPort` from
`ios tunnel ls` and passes them to `mounter auto-mount --rsd HOST PORT`.
It does not start a second Python tunnel. A go-ios userspace tunnel cannot be
used for this external RSD connection; use the kernel tunnel below. Initial
image download/personalization needs outbound network access. Cryptex mounting
and go-ios WDA launch were subsequently verified on the iOS 27.0.1 fleet.

## Prepare WDA without a paid developer membership

A free Apple Account can use an Xcode **Personal Team** for testing on a personal
device. Apple limits this to three apps per device, and the provisioning profile
expires after seven days; rebuild and reinstall WDA after expiry. This is a
short prototype workflow, not unattended profile renewal. See Apple's
[Personal Team requirements](https://developer.apple.com/help/account/basics/about-your-developer-account).

Use a Mac with a compatible Xcode for signing and initial installation. The
Linux host will run the installed runner afterwards. No Mac node or Mac process
is part of the documented Linux runtime. No certificate/private key needs to
be copied to the Linux host.

The source selected for this trial is
[Appium WebDriverAgent v16.15.0](https://github.com/appium/WebDriverAgent/tree/v16.15.0),
commit `e7e2665a00633dc174d7fc579f7e606bc9ba782a`. On the preparation Mac:

```sh
git clone --branch v16.15.0 --depth 1 https://github.com/appium/WebDriverAgent.git \
  tmp/ios-wda/WebDriverAgent
```

1. In Xcode Settings → Accounts, sign in to your Apple Account yourself. Complete
   any Apple agreement and two-factor authentication it requests.
2. Connect the unlocked iPhone to the Mac by USB, accept Trust, and enable
   Developer Mode. Also enable Settings → Developer → Enable UI Automation.
   These are separate switches. Let Xcode finish preparing the device.
3. Open `tmp/ios-wda/WebDriverAgent/WebDriverAgent.xcodeproj`. Select the
   `WebDriverAgentRunner` target, enable Automatically manage signing, and select
   your Personal Team. Set a unique runner bundle ID, for example
   `YOUR_UNIQUE_PREFIX.stf.WebDriverAgentRunner`. Resolve any signing errors Xcode
   reports; configure the library target's team too if requested.
4. Select the `WebDriverAgentRunner` scheme and the actual iPhone as destination.
   Use Product → Test to build, install and start the runner. Complete on-device
   developer trust prompts if requested. Stop this Xcode test before moving the
   phone to Linux.

For a reproducible artifact after configuring signing, run from the STF root
(replace the UDID with the real device identifier):

```sh
xcodebuild build-for-testing \
  -project tmp/ios-wda/WebDriverAgent/WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner -configuration Debug \
  -destination 'id=YOUR_UDID' \
  -derivedDataPath tmp/ios-wda/DerivedData \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration
```

The device artifact is
`tmp/ios-wda/DerivedData/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app`.
Inspect its `Info.plist` for the **installed** `CFBundleIdentifier` (Xcode normally
adds `.xctrunner`) and verify `PlugIns/WebDriverAgentRunner.xctest` exists.
Use this installed identifier for `--wda-bundle-id`, not a guessed value.
Signing profiles, DerivedData and this local WDA checkout stay outside Git.
If Xcode already installed the runner, do not copy the artifact just to run it.
If installation from Linux is needed, preserve the signed `.app` contents when
transferring it; the install command below accepts that directory.

The first hardware trial built WDA v16.15.0 with a free Personal Team and
compatible Xcode. The signed profile included the selected phone, and the runner
was accepted after the operator confirmed developer certificate trust. WDA
reported ready, created a session and returned a screenshot. Signing artifacts,
profiles, keys and account-specific Xcode changes are outside this contribution.

## Prepare the phone and tunnel

Connect and unlock the phone, accept **Trust this computer**, and enable
Developer Mode, completing any restart and on-device confirmation it requests.
Also enable **Settings → Developer → Enable UI Automation**. If WDA is ready
and streams images but taps, swipes or Home do not change the actual screen,
check this switch before treating successful command responses as proof of input.

```sh
ios list
ios --udid=YOUR_UDID info
```

Install a WDA artifact already signed for this phone. If it is already installed,
skip the install command. Use the actual artifact path and installed runner ID:

```sh
ios --udid=YOUR_UDID install --path=/absolute/path/WebDriverAgentRunner-Runner.app
ios --udid=YOUR_UDID apps --all --list
```

Start **one** go-ios tunnel agent in a separate terminal. This is the only
privileged process in the documented launch flow. Keep its pairing directory
between runs. The default kernel tunnel needs `/dev/net/tun` and network
administration permissions; it may also need outbound access to Apple when
developer images are personalized.

```sh
sudo install -d -m 700 /var/lib/stf-ios-pairing
sudo ios --udid=YOUR_UDID --tunnel-info-port=28100 tunnel start \
  --pair-record-path=/var/lib/stf-ios-pairing
```

If `sudo` cannot find a user-installed `ios`, use its absolute path. Run the
prototype itself as a normal user with access to the `usbmuxd` socket.
Do not run competing tunnel agents on the same host/ports.

## Start the prototype

Run from the repository root. There is no `npm install` or STF database
requirement for this entry point:

```sh
node tools/ios-prototype/main.mts --doctor --udid YOUR_UDID \
  --image-mounter pymobiledevice3 \
  --pymobiledevice3 ~/.local/share/stf-ios-venv/bin/pymobiledevice3
```

`--doctor` exits with code 1 if a prerequisite check fails. It does not install
apps, mount images, start WDA, or validate WDA signing. A passing doctor therefore
does not replace the hardware checks below.

Generate a local API token in a private directory outside Git:

```sh
mkdir -p ~/.local/state/stf-ios
chmod 700 ~/.local/state/stf-ios
openssl rand -hex 32 > ~/.local/state/stf-ios/token
chmod 600 ~/.local/state/stf-ios/token
node tools/ios-prototype/main.mts \
  --udid YOUR_UDID \
  --wda-bundle-id YOUR_INSTALLED_WDA_RUNNER_BUNDLE_ID \
  --image-mounter pymobiledevice3 \
  --pymobiledevice3 ~/.local/share/stf-ios-venv/bin/pymobiledevice3 \
  --token-file ~/.local/state/stf-ios/token
```

`npm run ios:prototype -- ...` is an equivalent entry point. Optional flags:

| Flag | Default |
| --- | --- |
| `--port` | `7400` (API on `127.0.0.1`) |
| `--wda-port` | `18100` (local forward to device `8100`) |
| `--mjpeg-port` | `19100` (local forward to device `9100`) |
| `--tunnel-port` | `28100` (existing go-ios tunnel registry) |
| `--go-ios` | `ios` |
| `--iproxy` | `iproxy` |
| `--image-mounter` | `go-ios`; select `pymobiledevice3` for the iOS 27 trial |
| `--pymobiledevice3` | `pymobiledevice3`; accepts the virtual environment's executable path |
| `--xctest-config` | `WebDriverAgentRunner.xctest` |

All four host ports must be distinct and available. The WDA artifact must use
the device-side default ports `8100` and `9100`. Readiness is reached only after
the owned runner answers HTTP and creates a session. Missing phones/tunnels,
untrusted signatures and startup errors remain visible in `GET /device` while
the service retries. Stop with Ctrl+C; the separately started tunnel stays up.

## API and first checks

All routes require `Authorization: Bearer <token>`. For example:

```sh
export STF_IOS_PROTOTYPE_TOKEN="$(cat ~/.local/state/stf-ios/token)"
curl -fsS -H "Authorization: Bearer $STF_IOS_PROTOTYPE_TOKEN" \
  http://127.0.0.1:7400/device
curl -fsS -H "Authorization: Bearer $STF_IOS_PROTOTYPE_TOKEN" \
  http://127.0.0.1:7400/screenshot --output /tmp/iphone-screenshot
curl -fsS -H "Authorization: Bearer $STF_IOS_PROTOTYPE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"bundleId":"com.apple.Preferences"}' \
  http://127.0.0.1:7400/apps/activate
```

| Request | Body or result |
| --- | --- |
| `GET /health` | API process liveness; does not claim device readiness |
| `GET /device` | State, selected UDID, last startup error, metadata, session generation |
| `GET /screenshot` | Image bytes from WDA |
| `GET /screen` | MJPEG response; the caller must keep the authenticated connection open |
| `POST /tap` | `{"x":0.5,"y":0.5}` |
| `POST /swipe` | `{"from":{"x":0.5,"y":0.8},"to":{"x":0.5,"y":0.2},"durationMs":500}` |
| `POST /text` | `{"text":"Hello"}`; an editable field must already be focused |
| `POST /home` | `{}` |
| `POST /apps/activate` | `{"bundleId":"com.apple.Preferences"}`; app must be installed |

Coordinates are normalized to `0..1` and converted using the current WDA window
size in logical points, not the screenshot's physical pixel dimensions.
POST bodies must be JSON objects, at most 16 KiB. Invalid inputs return 400,
missing authentication 401, browser Origin headers 403, an unavailable phone
503, and WDA/stream failures 502. This version has no browser UI; its API is for
explicit clients. Access a remote host through an SSH port forward rather than
publishing the API or raw WDA ports on the farm's public ingress.

## Acceptance record

Automated tests use real local HTTP connections to a fixture WDA server and
managed subprocesses. They verify API authentication/input handling, image and
stream transfer, W3C gesture construction, command serialization, explicit UDID
selection, retry/cleanup and literal subprocess arguments:

```sh
npm run test:ios-prototype
```

The [three-iPhone hardware record](ios-fleet-validation-2026-10-16.md) and
[local Linux trial](ios-local-validation-2026-10-17.md) distinguish hardware
results from fixture tests. They cover portrait control, signed IPA installation,
USB/WDA recovery, locked-screen access and per-phone isolation. The local trial
also checks native process cleanup and Compose startup with absent phones.
Landscape, multi-touch, Appium relay, automatic signing/profile renewal and
unattended unlocking through a passcode lock remain outside this prototype.

## Code anchors

| Responsibility | Source |
| --- | --- |
| CLI and local launch | `tools/ios-prototype/main.mts` |
| Read-only diagnostics | `tools/ios-prototype/doctor.mts` |
| Selected tunnel and external RSD validation | `tools/ios-prototype/tunnel.mts` |
| Device and process lifecycle | `tools/ios-prototype/runtime.mts`, `tools/ios-prototype/process.mts` |
| WDA session and gestures | `tools/ios-prototype/wda.mts` |
| Authenticated API and screen proxy | `tools/ios-prototype/server.mts` |
| Device-free integration tests | `tools/ios-prototype/test/prototype.test.mts` |
