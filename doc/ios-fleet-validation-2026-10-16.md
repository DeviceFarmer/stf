# Three-iPhone Linux trial — 2026-10-16

This records the original three-device Kubernetes hardware trial on a Linux USB
worker behind Proxmox USB passthrough. The local Compose/native path is checked
separately in the [local validation record](ios-local-validation-2026-10-17.md).
The Mac was used to build/sign/install WDA, not to run the device sessions.
These results precede preparation of the portable upstream contribution.

## Devices and signing

| Device | WDA-reported iOS | Portrait stream | Installed WDA profile expiry (UTC) |
| --- | --- | --- | --- |
| iPhone 16 Plus | 27.0.1 | 1290×2796 | 2026-10-22 16:07:26 |
| iPhone 13 Pro | 26.7.1 | 1170×2532 | 2026-10-23 17:44:57 |
| iPhone 14 Plus | 27.0.1 | 1284×2778 | 2026-10-23 17:44:57 |

WDA source is Appium 16.15.0; the runner's installed `CFBundleShortVersionString`
is `1.0`. These are different version fields. Each phone has its own selected
UDID, tunnel/API/bridge Pod, PVC, token and screen route. Private identifiers,
profiles, signed artifacts and account details stay outside Git.

## Observed results

- Three independent temporary STF users reserved one phone each simultaneously.
  All three public screen streams delivered JPEG frames with their respective
  registered display dimensions. Cyclic attempts to view another user's phone
  all received HTTP 403. The temporary users and reservations were removed.
- Device name, battery/charging, free/total storage and valid WDA expiry reached
  STF. All three private caches retained device-specific metadata across Pod
  recreation. Lost reads did not replace known values with zero or fresh timestamps.
- Deliberately terminating WDA on 16 Plus and later 13 Pro triggered automatic
  recovery with a new runtime generation. During the 13 Pro test, only its owner
  and stream were released; the two other users retained ownership and live frames.
- The operator disconnected 13 Pro for over two minutes, rebooted it, then
  reconnected USB and unlocked it. Linux prepared WDA automatically and STF
  accepted a new reservation and 1170×2532 stream. During the whole interruption,
  16 Plus and 14 Plus retained their original owners and continued delivering
  frames. The disconnected phone retained its metadata and reported `disconnected`.
- The real Shake implementation advanced a test app's UIKit motion counter
  1→2→3 in consecutive Linux API calls, then to 4 through an owned public STF
  `device.shake` transaction. This verifies UIKit motion delivery on 16 Plus;
  it does not verify injected CoreMotion samples.
- The operator found **Enable UI Automation** disabled on both newly prepared
  phones and enabled it. This setting is separate from Developer Mode and is
  now explicitly included in the onboarding instructions.
- On 13 Pro, WDA's simulated hardware Home press returned success without
  leaving Settings. The dedicated, sessionless `POST /wda/homescreen` actually
  switched to Springboard. The provider now uses that endpoint while retaining
  its input queue and runtime readiness checks; a regression test covers the route.
- After deploying the Home correction, three users again held three distinct
  streams. Home was sent separately through public STF to 13 Pro, 14 Plus and
  16 Plus. WDA confirmed Springboard on each selected phone while phones awaiting
  their own command remained in Settings. All temporary sessions were released.

## Artifacts and automated checks

- STF app/API/WebSocket/processor and bridges: source `c2a7d10d767763280580e9af366cacd319ead5ff`.
- Prototype Home correction: source `70fa6a3437be984a50ce2a90357a59e5038097de`.
- Local checks before the Home correction: 270 server tests, 45 prototype tests,
  79 component tests, lint/type/translation checks and production build passed.
  The Home correction passed all 46 prototype tests and targeted lint.
- The preceding deployed commit passed the complete GitHub Actions matrix,
  including Android emulator tiers. The Home correction's Linux Node 22.18/24
  tests and prototype image build passed; remaining checks are recorded on the PR.

## Subsequent iOS 26 Shake regression

The operator reproduced `IOS_SHAKE_MENU_UNSUPPORTED` on 13 Pro. Its system
AssistiveTouch tree exposes the floating `AssistiveTouchNubbit` and menu actions
as accessible `Other` nodes, not `Button`; the final Russian label is
`Встряхнуть`, not `Встряхивание`. The correction recognizes these known controls,
ignores hidden/disabled elements and preserves the existing unknown-menu failure
and cleanup behavior. A new fixture covers this actual iOS 26 structure.

The corrected implementation was run from Linux against the original WDA tree
and a separately signed test application on 13 Pro. Its UIKit Shake counter
advanced **0→1**, confirming motion delivery rather than HTTP success alone.

## Remaining verification

Full shared-VM reboot, physical profile expiry/renewal, landscape,
multi-touch and Appium Grid remain unverified or unsupported. Browser visual
inspection remains a manual operator check.
