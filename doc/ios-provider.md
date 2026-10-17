# Linux iOS provider in STF

The provider registers an iPhone in the existing STF device list and uses STF
ownership, groups and transactions for browser control. A Mac is used to build
and sign WebDriverAgent (WDA) and test apps; it is not a runtime node.

See the [recorded demonstration](ios-media/README.md) for real STF screenshots,
short videos and GIFs of IPA installation, Shake and lock/unlock.

For a local installation without Kubernetes, start with the
[Linux Compose/native quick start](../docker/ios/README.md). It builds matching
images, accepts a shared device configuration and generates private local state.
The manual commands below describe the same roles for an existing STF deployment.

## Processes and source

The runtime has three roles, independent of the deployment system.
The local launcher supervises them for every explicitly configured phone.

| Process | Responsibility | Source |
| --- | --- | --- |
| `tunnel` | Privileged go-ios kernel tunnel and persistent pairing | `tools/ios-prototype/container.mts` |
| `runtime` | Local API, selected UDID, developer image mounting, WDA startup, reconnects, IPA jobs | `tools/ios-prototype/{main,runtime,server,installations}.mts` |
| `stf ios-provider` | Device registration, ownership, ZeroMQ commands, authenticated screen WebSocket | `lib/cli/ios-provider/index.ts`, `lib/units/ios-provider/` |

The host owns `usbmuxd`; Compose mounts only its socket at `/run/usbmuxd`.
Only the tunnel runs privileged. Runtime and bridge run as UID 1000 in Compose,
or as the invoking Linux user in native mode. Socket watchdogs restart/remount
stale socket mounts. Pairing, developer images, telemetry and job records are
retained in private per-device state; tokens are private generated files.

The prototype listens on loopback port 7400; WDA and MJPEG forwards use 18100
and 19100, and the tunnel registry uses 28100. The public screen endpoint is
the STF-authenticated WebSocket on 17440. Raw WDA and the prototype API are not
public ingress endpoints. Each WDA recovery changes a generation; each API
process has a new instance UUID. Commands from the previous session are dropped.
Releasing ownership aborts
forwarded control requests and prevents queued runtime actions from reaching WDA.
Cancellation cannot undo an input or power command already accepted by iOS.

## Runtime dependencies

The runtime entry point uses Node.js native TypeScript support without npm
libraries. Use an official Node.js 22.18+ or 24 build and verify
`node -p process.features.typescript`; some distribution builds disable it.

| Dependency | Tested source |
| --- | --- |
| go-ios 1.3.2 | [CLI and WDA launch](https://github.com/danielpaulus/go-ios/tree/v1.3.2) |
| pymobiledevice3 11.32.0 | [Developer image mounter](https://github.com/doronz88/pymobiledevice3/blob/v11.32.0/pymobiledevice3/services/mobile_image_mounter.py) |
| iproxy (libusbmuxd) | [USB-only loopback forwarding](https://github.com/libimobiledevice/libusbmuxd/blob/master/tools/iproxy.c) |
| Appium WebDriverAgent 16.15.0 | [Runner source](https://github.com/appium/WebDriverAgent/tree/v16.15.0) |

On Debian/Ubuntu, install `libusbmuxd-tools` for iproxy and
`libimobiledevice-utils` for pairing. Install pymobiledevice3 in a private venv:

```sh
python3 -m venv ~/.local/share/stf-ios-venv
~/.local/share/stf-ios-venv/bin/python -m pip install 'pymobiledevice3==11.32.0'
```

Put that venv's `bin` directory on PATH, or pass its executable path with
`--pymobiledevice3`. The runtime reads the selected device's `address` and `rsdPort`
from the existing go-ios kernel tunnel and passes `--rsd HOST PORT` to the mounter.
It does not start a second Python tunnel. A go-ios userspace tunnel cannot serve
this external RSD connection. Initial developer-image personalization/download
requires outbound Internet access. Compose bundles these dependencies.

## Manual launch against an existing STF deployment

Required values are the selected UDID, the installed signed WDA runner ID and
a token file (or `STF_IOS_PROTOTYPE_TOKEN`). `--install-dir` defaults to
`~/.stf-ios-installations`. IPA installation is disabled without `--storage-url`.
The runtime and its read-only `--doctor` mode accept these additional options:

| Option | Default |
| --- | --- |
| `--port`, `--wda-port`, `--mjpeg-port`, `--tunnel-port` | `7400`, `18100`, `19100`, `28100` |
| `--go-ios`, `--iproxy` | `ios`, `iproxy` |
| `--image-mounter` | `go-ios`; use `pymobiledevice3` for iOS 27 |
| `--pymobiledevice3` | `pymobiledevice3`, or an absolute virtual-environment executable path |
| `--xctest-config` | `WebDriverAgentRunner.xctest` |
| `--state-dir` | `~/.stf-ios` |

All four host ports must be distinct and available. The signed WDA artifact must
use device ports `8100` and `9100`. Stop any competing WDA/Appium controller first.
Compose/native launchers choose ports and create private tokens automatically;
for a manual deployment, first generate a token and start the kernel tunnel in
a separate terminal:

```sh
mkdir -p ~/.local/state/stf-ios
chmod 700 ~/.local/state/stf-ios
openssl rand -hex 32 > ~/.local/state/stf-ios/token
chmod 600 ~/.local/state/stf-ios/token
sudo install -d -m 700 /var/lib/stf-ios-pairing
sudo ios --udid=YOUR_UDID --tunnel-info-port=28100 tunnel start \
  --pair-record-path=/var/lib/stf-ios-pairing
```

Use that token file for both runtime and bridge, and keep the pairing directory
between runs. The manual tunnel stays alive until explicitly stopped; unlike
`stf local`, it is not supervised by the provider. Run the runtime/bridge as an
ordinary user with access to the host usbmuxd socket. Check prerequisites without
starting WDA (exit code 1 means a failed prerequisite):

```sh
node tools/ios-prototype/main.mts --doctor --udid YOUR_UDID \
  --image-mounter pymobiledevice3
```

The prototype entry point needs no npm dependencies:

```sh
node tools/ios-prototype/main.mts \
  --udid YOUR_UDID \
  --wda-bundle-id YOUR_SIGNED_RUNNER.xctrunner \
  --image-mounter pymobiledevice3 \
  --token-file ~/.local/state/stf-ios/token \
  --storage-url http://127.0.0.1:7102/
```

The STF bridge is started separately:

```sh
node lib/cli/index.js ios-provider \
  --serial YOUR_UDID --token-file ~/.local/state/stf-ios/token \
  --prototype-url http://127.0.0.1:7400 \
  --api-url http://127.0.0.1:7106 \
  --public-origin https://YOUR_STF_HOST \
  --storage-url http://127.0.0.1:7102/ \
  --screen-url wss://YOUR_STF_HOST/ios/YOUR_DEVICE_ID/screen \
  --connect-push tcp://127.0.0.1:7113 \
  --connect-sub tcp://127.0.0.1:7111 \
  --name 'Linux iOS' --market-name 'iPhone 16 Plus'
```

The bridge defaults are prototype URL `http://127.0.0.1:7400`, screen port
17440 and ownership timeout 900 seconds. Every argument also has a corresponding
`STF_IOS_PROVIDER_*` environment variable. Adapt API, storage and ZeroMQ addresses
to your deployment. Route the public screen URL through your reverse proxy to the bridge screen port, preserving
cookies, Origin and WebSocket headers; see the local Nginx generator for an
example. UDID and WDA bundle ID must match the selected physical phone.

## Installing an IPA

Claim the iPhone, open its dashboard and drop one `.ipa` into **App Upload**,
or onto the device screen. The limit is 1 GiB. STF accepts an already signed
development, ad hoc or enterprise package provisioned for that phone; it does
not sign, re-sign or bypass Apple verification. An App Store download, simulator
build or arbitrary unsigned IPA is not an installation artifact for this flow.

The browser uploads the file through existing `/s/upload/blob` storage and sends
`InstallMessage` with a unique `requestId`. The bridge accepts only STF blob
paths, forwards the artifact identifier to the local API and attaches a private
ownership lease. The browser cannot supply a download host or command arguments.

The job downloads only from the configured storage origin, without redirects.
The bounded Python preflight checks ZIP paths and sizes, the app plist, arm64
architecture, minimum iOS version, embedded profile expiry and device inclusion.
It verifies the profile CMS structure/signature without checking its Apple trust
chain. **iOS performs the authoritative application and profile trust checks.**
The installer invokes `ios --udid=... install --path=...`, confirms the bundle
and version in `ios apps`, and optionally opens the app through the owned WDA
session. WDA itself cannot be replaced through this panel.

The UI displays upload/download percentages and named indeterminate stages for
validation, installation, verification and launch. It shows app metadata and
profile expiry after success. A launch failure is reported separately from a
successful installation. The panel supports cancellation and restoring the
latest job after a page refresh within the same ownership session. This first
version accepts local files; URL installation and iOS uninstall are not exposed.

| Private API (all POST, JSON, Bearer token) | Purpose |
| --- | --- |
| `/installations/start` | Idempotent start with request UUID, lease, artifact ID/hash, runtime instance/generation and launch flag |
| `/installations/status` | Job by UUID or latest job for the supplied lease |
| `/installations/keepalive` | Extend the active ownership lease by 10 seconds |
| `/installations/cancel` | Stop the job belonging to that lease |

The bridge renews the job lease during its normal polling. Ownership release,
USB recovery, API restart or missing bridge heartbeats interrupt the operation.
Interrupted jobs are never retried automatically. Stopping an installer cannot
undo work already accepted by iOS, so the UI explicitly reports an uncertain
outcome where appropriate. It does not delete an app as cancellation cleanup.

Private job records are bounded to 64 retained jobs, expired after 24 hours on
startup or the next start. Temporary IPA files are removed when jobs finish and
abandoned job directories are removed after restart. The existing STF temporary
storage service controls the lifetime of the uploaded blob.

## Verification

`npm run test:unit` covers the STF bridge, wire compatibility, authentication and
prototype lifecycle. `npm run test:ios-prototype` also exercises job persistence,
idempotency, ownership, cancellation, stream limits and synthetic ZIP/plist/
Mach-O/CMS fixtures. `npm run test:component` covers browser-side file routing,
status polling, lost acknowledgements and transaction timeouts without browser
automation. Actual IPA acceptance and app launch still require a signed artifact
and a real iPhone; record that separately from fixture tests.

### Hardware coverage and limits

| Environment | Devices | Observed behavior |
| --- | --- | --- |
| Linux amd64 USB worker, Kubernetes, Proxmox passthrough | iPhone 13 Pro / iOS 26.7.1; 14 Plus and 16 Plus / iOS 27.0.1 | Three simultaneous owners and streams; cross-owner access denied; isolated Home and WDA/USB recovery; 13 Pro reboot recovered after physical unlock; health/signing metadata persisted |
| Clean Ubuntu 26.04 amd64 VM, Docker Engine 29.9.1 / Compose 5.6.0 | iPhone 13 Pro / iOS 26.7.1 and Galaxy A55 / Android 16 | Both images built; public STF screen/input, signed IPA installation/launch, Shake, lock/unlock and screenshots; iPhone USB reconnect and usbmuxd socket replacement recovered |
| Native `stf local` on the same Ubuntu host | The same 13 Pro | Public screen/control/IPA checks; shutdown removed runtime, bridge, forwards and root tunnel/helper |

Real UIKit test-app counters confirmed Shake events on 13 Pro and 16 Plus.
The [recordings](ios-media/README.md) show manual browser checks on 13 Pro.
These hardware trials establish the behaviors above for those environments;
automated tests use fixtures and do not replace fresh hardware validation.

Remaining limits and verification gaps:

- Simultaneous real multi-iPhone Compose operation has not been tested. The local
  trial used one connected iPhone and two configured absent phones to check isolation.
- A shared USB disconnect also disconnected the Android phone; its existing ADB
  container needed a restart to rediscover it. This does not establish automatic
  Android recovery across a shared USB failure.
- A full shared-VM reboot and physical WDA expiry/renewal remain unverified.
  Power commands and passcode entry were not repeated in the local packaging trial.
- Landscape, multi-touch and Appium Grid integration are not supported by this version.

## Health, signing and recovery

`GET /device` includes a bounded `ios` status object: preparation phase, actionable
reason, retry count, last-ready time, device name, lock state, battery, free/total
storage, telemetry time and WDA signing metadata. The provider selects the UDID
for **every** device command. Battery and storage refresh about every 30 seconds;
installed WDA and profiles refresh on connection and every 30 minutes. Failed
reads retain their previous values and timestamps. Private `--state-dir`
(default `~/.stf-ios`) preserves that metadata across runtime restarts on persistent storage.

WDA expiry comes from installed provisioning profiles matching the exact runner
application identifier and the selected device. Multiple matching profiles are
reported as ambiguous with the earliest date; the service cannot prove which
one signed the installed app. Missing/unreadable profiles are not presented as
valid. An expiry warning starts 48 hours before the reported UTC expiry.

The STF bridge publishes the existing `DevicePropertiesMessage` with reserved
property `stf.ios.status`. The processor validates and saves it only on iOS
records; WebSocket updates the device card and control/info panes. Metadata also
updates while an already registered phone is disconnected. A phone that has
never completed WDA preparation has no STF identity yet: inspect its private
runtime/provider logs during onboarding.

Diagnostics distinguish missing USB, trust/unlock, WDA missing or expired,
tunnel, developer-image and WDA/session startup failures. Recovery retries
automatically. A screen lock alone keeps the phone present, owned and streaming
while WDA remains ready. The owner can use **Lock screen / Unlock screen**;
iOS 27 locks through a short fixed Power IOHID event; earlier versions use the
standard English/Russian AssistiveTouch Lock Screen action and restore its
settings. An asleep iOS 26 phone may need the system Home command before its
AssistiveTouch control is available. Unlock explicitly wakes the system UI
before WDA's unlock command. Both UI buttons stay available because WDA's cached
lock flag can lag a sleeping screen. Repeating Lock on a known locked device
does not send another Power press. Automatic unlock supports a simple lock
without a passcode. If it remains
locked, swipe and enter the code directly on the streamed device screen. STF does
not save a passcode. Screenshots, touch, Home and text input remain available
while locked; shaking and app activation still require an unlocked screen.
An asleep display may provide black frames; unlocking wakes it.

**Restart iPhone** and **Power off iPhone** require an in-product confirmation
and the current owner. They use go-ios diagnostics for the selected UDID, not a
simulated side/volume chord. The UI reports command acceptance, not completed
startup/shutdown. Power off requires physical access to turn the phone on again.
Acceptance invalidates queued commands; a real disconnect ends ownership and
viewers. Reconnect and claim again after recovery. Old commands and IPA jobs are
not replayed. The iOS screen client retries temporary WebSocket failures with
bounded backoff while the current user still owns a ready, present device;
release and unmount cancel pending retries. go-ios v1.3.2 may exit zero on a power error: the provider also
requires its explicit `ok` log acknowledgement and rejects error logs.
After a full device reboot, physical unlock may be required by iOS before USB
services become available. A lost Proxmox USB assignment must be restored at the
hypervisor; a provider cannot recover hardware absent from the VM.

To renew a Personal Team runner:

1. Reconnect the selected iPhone to the signing Mac and open the same WDA project.
2. Select the existing Team and runner bundle ID, enable automatic signing,
   then build/install the runner for that device. Keep the same identifier.
3. Confirm developer trust/Developer Mode on the device if iOS requests it.
   Also check Settings → Developer → Enable UI Automation; it is a separate
   required switch, as described in [Appium's device preparation guide](https://github.com/appium/appium-xcuitest-driver/blob/master/docs/getting-started/device-setup.md#required-settings).
4. Return USB to the Linux VM, unlock and confirm computer trust when prompted.
5. The provider reconnects without a Mac runtime node. Check the new expiry in STF.

Do not delete persistent pairing state or replace the runner through App Upload as a
renewal shortcut. A profile alone cannot renew the app's code signature.

## Shake on physical iPhones

The iPhone dashboard has **Shake phone**. It invokes the system AssistiveTouch
Shake action, which sends UIKit motion events to the foreground application.
It does not synthesize CoreMotion accelerometer samples; apps listening only to
raw sensor data may require a different debug trigger.

The command is an owned transaction (`device.shake` → `IosShakeMessage` → private
`POST /shake`). It shares the input queue, checks the runtime instance/generation,
and cancels further gestures if ownership is released. UI waits for the result
and displays a failure rather than claiming a successful shake.

AssistiveTouch is enabled only for the operation when necessary. WDA inspects
points without tapping to locate its separate system process, then uses bounds
from its actual accessibility elements. It selects only known Device, More and
Shake actions; English and Russian standard menus are supported. Customized or
unrecognized menus fail explicitly. Existing WDA application-detection settings
and the original AssistiveTouch enabled state are restored on success, failure
and request cancellation. No WDA fork/re-signing is needed for this command.

See [Apple's AssistiveTouch guide](https://support.apple.com/en-am/guide/iphone/iph96b21954/ios)
and [Appium's shake limitation](https://appium.github.io/appium-xcuitest-driver/latest/reference/execute-methods/#mobile-shake).
