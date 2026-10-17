# Local Linux iOS validation — 2026-10-17

The local installation was exercised on a newly provisioned Ubuntu 26.04 amd64
VM with Proxmox USB passthrough, Linux 7.0.0-38, Docker Engine 29.9.1 and Compose
5.6.0. Kubernetes was not installed or used. The existing cluster was left as a
separate deployment.

## Installation and configuration

- Both the standard STF image and `docker/ios/Dockerfile` built from source on
  this VM. The iOS image's embedded tests completed during its build.
- The distribution's Node.js 22.22.1 was built without TypeScript support.
  Official Node.js 24.22.0 worked; the new shell launcher rejects unsupported
  builds with an actionable message before loading `.mts` files.
- A private JSON file selected the iPhone and installed signed WDA identifier.
  No per-phone ports were configured by the operator.
- `doctor` verified the local Docker Engine, TUN device, usbmuxd socket, phone
  trust, model/iOS version and installed WDA bundle identifier.
- Real Compose configuration parsing and Nginx's configuration check passed.
  A real Docker run confirmed literal dollar signs survive in environment values
  and bind paths without unintended Compose interpolation.
- The initial device-volume setup exposed a UID ownership race caused by Docker
  populating an empty volume from `/home/node`. The init helper now owns the volume
  root first, using only CHOWN/FOWNER capabilities. Subsequent recreations retained
  state and started successfully; CI includes the non-root-owned-volume case.

## Hardware and public STF path

The connected devices were iPhone 13 Pro/iOS 26.7.1 and Galaxy A55/Android 16.
The phone's existing Personal Team WDA was reused. A signed UIKit test application
was built on the preparation Mac with a valid cached profile covering the 13 Pro;
no signing key or Apple account credentials were copied to Linux.

Tests used HTTP, Socket.IO and the screen WebSocket protocol through the public
STF entry point. No browser automation or temporary API modifications were used.

- Mock login, device listing, claiming and release worked.
- The same-origin iPhone screen delivered JPEG frames with the owner's session.
  Missing credentials and a foreign Origin were rejected with HTTP 403.
- Public Lock/Unlock transactions completed and video remained available through
  the locked-screen path. Public screenshot capture completed.
- A signed IPA uploaded to the shared STF storage, passed preflight, installed,
  and launched on the iPhone. The public Shake transaction completed in the
  foreground test app, and screen delivery continued.
- With Android enabled and `SCREEN_GRABBER=minicap-apk`, both connected devices
  were present and ready. Android's public screen delivered JPEG frames.
- A configuration containing the connected iPhone and two additional absent
  test UDIDs started successfully. Docker inspection verified three distinct
  per-phone network namespaces, shared only by each phone's own processes, and
  no published iOS private ports. The absent phones did not block the connected
  iPhone or Android.
- Restarting the host usbmuxd service replaced its socket. Tunnel/runtime
  watchdogs exited, Docker restarted/remounted them, and WDA recovered. The
  iPhone could be claimed again and its public image read after recovery.
  Android retained its reservation and screen connection; after waking its
  otherwise static/asleep display, the same connection delivered a fresh frame.
  A transient first WDA session could restart once more during recovery; old
  ownership was released and the stable recovered phone was reclaimed.
- A physical iPhone USB unplug/replug also recovered automatically, without a
  manual provider restart. A new reservation and authenticated JPEG stream
  succeeded after reconnecting.
- During that physical trial, the VM kernel also recorded an Android USB
  disconnect/re-enumeration. The Android remained visible in host USB but the
  standard ADB container did not rediscover it. Restarting only that ADB
  container restored discovery; both phones could then be claimed and their
  public screens delivered JPEG frames. This trial therefore does not establish
  uninterrupted Android operation across a shared USB disconnect.

## Native `stf local`

The built STF distribution was also run directly as the ordinary Linux user,
with a separate local RethinkDB container and host go-ios 1.3.2, iproxy 2.1.1,
and pymobiledevice3 11.32.0 in a Python 3.14 venv. Building its `pylzss` dependency
required compiler/Python development packages. Only the tunnel helper used sudo.

`stf local --ios-config` assigned its internal ports automatically. The same
public login, authenticated/unauthorized screen checks, lock/unlock, screenshot, signed IPA
installation/launch and Shake checks passed through its local proxy. Interrupting
the local session ended the runtime, bridge, iproxy and sudo-owned tunnel/helper;
process inspection found no remaining native iOS processes.

The final local `npm test` run passed compilation, lint/type/translation checks,
282 server tests and 58 iOS runtime tests. The new CI job validates Compose,
Nginx and minimal-capability volume initialization without physical devices.

## Limits

- Compose hardware testing used one iPhone and one Android; simultaneous real
  multi-iPhone testing belongs to the earlier Kubernetes record. Two absent
  configured phones establish isolation/startup behavior, not that hardware matrix.
- A complete VM reboot remains a separate follow-up check. Physical iPhone USB
  recovery, socket replacement and container recreation were exercised here;
  Android hotplug after the shared disconnect required an ADB restart as above.
- Power-off/reboot buttons and passcode entry were not repeated in this local
  packaging trial. Existing provider limitations still apply.
- No upstream PR was created for this local-launch work.
