# Real iPhones on a local Linux host

This experimental provider runs physical iPhones in STF without a Mac runtime
node or Kubernetes. A Mac with compatible Xcode is used to build/sign/install
WebDriverAgent (WDA), including again when its provisioning profile expires.
STF installs already signed IPA files; it does not sign or re-sign applications.

The runtime was tested with iPhone 13 Pro/iOS 26.7.1 and iPhone 14 Plus and
16 Plus/iOS 27.0.1 on Linux amd64. The local Compose and native launch paths were
also exercised on a clean Ubuntu 26.04 VM with the 13 Pro, including signed IPA
installation and browser-protocol control. Compose was tested alongside a Galaxy
A55/Android 16 and with two additional configured but absent iPhones. This does
not establish simultaneous multi-iPhone hardware support in Compose; the earlier
three-phone trial used Kubernetes. See the [local validation record](../../doc/ios-local-validation-2026-10-17.md).

## Prepare the phone

1. Build and install a development-signed Appium WDA runner using Xcode. The
   tested source is [WebDriverAgent v16.15.0](https://github.com/appium/WebDriverAgent/tree/v16.15.0).
   Select `WebDriverAgentRunner`, your signing team and the actual phone, then
   Product → Test. Stop the Xcode test before letting STF control the device.
   See [the signing walkthrough](../../doc/ios-prototype.md#prepare-wda-without-a-paid-developer-membership).
2. Enable **Developer Mode** and, separately, **Settings → Developer → Enable UI
   Automation**. Confirm developer certificate trust in Settings → General →
   VPN & Device Management if requested.
3. Record the installed runner's `CFBundleIdentifier`; it commonly ends in
   `.xctrunner`. Put this exact identifier in `wdaBundleId` below.
4. Connect USB to the Linux machine, unlock the phone and confirm computer trust.
   For a VM, pass each phone through to that VM. A phone cannot be assigned to
   both the existing cluster VM and this local VM at once.

An Apple Developer Program subscription is not required for the tested Personal
Team workflow, but its profiles expire after seven days. Renew by rebuilding and
reinstalling WDA with the same bundle identifier on the signing Mac. No Apple
private key or account password is needed on Linux. See
[Apple's Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Prepare Linux

Use a local, rootful Docker Engine with the Compose plugin, an official Node.js
22.18+ or 24 build with native TypeScript support,
Git, `/dev/net/tun` and host `usbmuxd`. CI uses Ubuntu 24.04; the clean hardware
trial used Ubuntu 26.04 amd64. Docker Desktop, rootless Docker and remote Docker contexts are not the
USB launch path. Follow [Docker's Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/)
for Engine/Compose. Install the host pairing utilities:

```sh
sudo apt-get update
sudo apt-get install -y usbmuxd libimobiledevice-utils
```

Some distribution Node.js builds disable TypeScript even when the version is
new enough (observed with Ubuntu 26.04's Node.js 22.22.1). Verify with
`node -p process.features.typescript`; a false value requires a supported official
Node.js build. The shell launcher below checks this before loading `.mts` files.
Official builds are available from [Node.js](https://nodejs.org/en/download).

Connect the prepared phone before checking:

```sh
idevice_id -l
idevicepair pair
```

For several phones, use `idevicepair -u YOUR_UDID pair` for each selected UDID.
If the daemon is unavailable, start the installed `usbmuxd` service and retry.
Confirm the on-device trust prompt and repeat pairing as needed. Trust for the
Linux host is separate from trust for the signing Mac.

## Configure one or several iPhones

From a checkout containing this feature:

```sh
cp docker/ios/devices.example.json ios.local.json
```

Edit `ios.local.json` (ignored by Git, Docker builds and npm packaging):

```json
{
  "publicOrigin": "http://192.168.1.50:7100",
  "wdaBundleId": "com.example.WebDriverAgentRunner.xctrunner",
  "devices": [
    {"udid": "YOUR_FIRST_UDID"},
    {"udid": "YOUR_SECOND_UDID", "wdaBundleId": "other.team.WDARunner.xctrunner"}
  ]
}
```

Replace the example values; UDIDs are device identifiers, not the sample strings.
Use `http://localhost:7100` only if the browser runs on the Linux machine itself.
The exact browser origin, including port and hostname, must match `publicOrigin`.
For this local quick start use HTTP; HTTPS/reverse-proxy integration is a separate
deployment configuration. Mock authentication is the existing local STF default.

An optional device `name` overrides its STF display model label; normally the
provider reads the model from the phone. Add `"android": true` at the top level
to also launch the existing ADB/Android provider. Android is disabled by default
for this iOS launcher; the original `docker compose up` remains unchanged.
For Android 16, set `SCREEN_GRABBER=minicap-apk` when preparing/starting this
launcher, as in the existing Compose CI configuration. This only changes the
Android provider's screen backend.

## Start with Docker Compose

No repository npm install is needed for this launcher. Node runs its `.mts` entry
point directly. Build from this checkout so STF and the iOS tools match:

```sh
sh bin/stf-ios-compose build
sh bin/stf-ios-compose doctor --config ios.local.json
sh bin/stf-ios-compose up --config ios.local.json --no-build
```

`doctor` checks the host, Docker, USB access and selected phones' pairing and
installed WDA identifiers. Without `--config`, it lists connected phones. It
does not start WDA or prove that a signing profile is valid or UI Automation is
enabled; runtime status provides preparation failures after startup. `up` without
`--no-build` builds both images first.

Open `publicOrigin`, sign in and select a ready iPhone. The first developer image
download/personalization needs outbound Internet access. A locked/expired/untrusted
phone can take longer or need an on-device action; stack health means its API
listeners are up, not that every selected phone has completed WDA preparation.
Use logs if a never-ready phone is not yet registered in the device list.

```sh
sh bin/stf-ios-compose status
sh bin/stf-ios-compose logs
sh bin/stf-ios-compose down
```

Equivalent npm shorthand: `npm run ios:compose -- COMMAND ...`.

The default project is `stf-ios`; generated files and tokens live in the private
`~/.stf-ios-compose/stf-ios` directory. `--project NAME` and `--state-dir DIR` select
another instance; repeat those options for status/logs/down. Each phone receives
a stable ID, private token and named state volume. The session secret is generated
once and retained. `down` retains database and device volumes; do not delete them
as a routine recovery step. RethinkDB is persistent; the existing temporary upload
backend discards uploaded blobs when its container is replaced.

The default image tags are `stf-local:ios` and `stf-ios-runtime:local`.
`--stf-image` and `--ios-image` select matching prebuilt images with `--no-build`.
Pin both to the same source revision; `devicefarmer/stf:latest` does not acquire
unreleased changes from this checkout. `--socket` overrides `/run/usbmuxd`.

## Processes and recovery

The normal STF services reuse the root Compose topology. Per phone, the launcher
adds an initialization job, a small persistent network namespace, a privileged
go-ios tunnel, an unprivileged runtime and the existing `stf ios-provider` role.
Only the tunnel is privileged. The init job has only the ownership capabilities
needed to prepare its state volume. Runtime and provider run as UID 1000.

All three processes for a phone share its network namespace. Different phones
can use the same internal API/WDA/MJPEG/tunnel/screen ports without collisions.
No raw WDA or device API ports are published. Nginx routes each same-origin
`/ios/ios-<id>/screen` WebSocket to exactly one provider, preserving cookies,
Origin and authorization; the provider enforces STF ownership.

The namespace anchor stays alive during child restarts. A socket watchdog exits
the tunnel/runtime container if the mounted host usbmuxd socket becomes stale;
Docker's restart policy remounts its replacement. A phone absent from USB is
handled by the existing runtime retry loop. `up` recreates the whole stack so a
replaced namespace never leaves old siblings attached; it can interrupt existing
sessions. Use it after configuration changes, not as a per-phone restart command.

## Native development with `stf local`

Developers with the normal STF build/dependencies can use the same JSON file:

```sh
sudo -v
stf local --ios-config ./ios.local.json
```

For a source checkout use `npm run local -- --ios-config ./ios.local.json`.
This mode additionally requires host `ios`/go-ios v1.3.2, `iproxy` and
`pymobiledevice3` 11.32.0 on PATH. Follow the dependency links in the
[runtime guide](../../doc/ios-prototype.md#requirements-and-verified-sources).
The usual native STF database/service prerequisites still apply.
On Ubuntu 26.04, installing pymobiledevice3 into the system Python 3.14 venv
required `build-essential` and `python3-dev` to build its `pylzss` dependency.
Use a private venv and put its `bin` directory on PATH for the local session.

`sudo -v` authorizes only the tunnel helpers started via `sudo -n`; the web
services, runtime and providers run as the invoking user. A helper monitors its
parent's lifetime pipe and stops its root tunnel when the local session exits.
Internal TCP ports are selected automatically, and each child's restart uses
the same selected ports for that session. Persistent per-phone data is stored
under `~/.stf-ios-local` (`--ios-state-dir` overrides it). `publicOrigin` controls
the local web host/port. As in Compose, `android` opts into the Android provider.

## Acceptance checklist for another host

- On a clean Ubuntu VM, build both images and start STF following only this guide.
- Verify picture, input, IPA installation, lock/unlock and Shake on a real phone.
- Disconnect/reconnect USB and restart usbmuxd; verify automatic recovery.
- Recreate containers and confirm pairing, metadata and signing information persist.
- Run several selected phones simultaneously and verify isolated ownership/streams
  and recovery of one phone while the others remain usable.
- Verify the optional Android provider and the original Android-only Compose path.
- Exercise native `stf local` startup/shutdown and verify no root tunnel is orphaned.

Turning on a powered-off phone needs physical access. A full reboot may require
physical first unlock before iOS permits USB services. STF does not store or
bypass the passcode. See [provider behavior](../../doc/ios-provider.md) for the
IPA, ownership and device-control contracts.
