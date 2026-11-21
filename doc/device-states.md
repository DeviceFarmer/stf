# Device states

STF keeps a few fields for each device. The [REST API](API.md) returns these fields as they are.
The web UI combines them into one state, which it shows in the device list.
This page explains both: what each value means, what causes it and what to do about it.

## Device fields

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `present` | boolean | A provider sees the device. A device worker does not have to run. See the notes below. |
| `status` | number | The `adb` state of the device. See [`status` values](#status-values). |
| `ready` | boolean | The device worker finished its setup. The device can be used. |
| `owner` | object or `null` | The user who holds the device: `email`, `name` and `group`. |
| `usage` | string or `null` | `"automation"` when the device was reserved through the API. `null` otherwise, for example when it was reserved in the web UI. |
| `using` | boolean | The device is held by you. It is computed for each request and not stored. |
| `claimed` | boolean | The device is kept for its last owner while it reboots. It is computed for each request. |
| `ios` | object | iOS only. The health of the iPhone runtime. See [iOS devices](#ios-devices). |

Notes:

* `present` becomes `true` when a provider finds the device, and again when its worker sends a
  heartbeat. Offline, Unauthorized and Connected devices have no worker.
  `present` becomes `false` when the device is unplugged, when its worker stops or when no
  heartbeat arrives within the reaper `--heartbeat-timeout` (30 seconds by default).
* `ready` becomes `false` when a provider finds the device and `true` when the device worker
  finishes its setup. It is not reset when the device goes away. Always check `present` first.
* The API returns `owner` as `null` when `present` is `false`. It computes `using` before it
  removes `owner`, so an absent device can come back with `owner: null` and `using: true`. This
  happens when the stored owner is you, or when you are an administrator and the device still has
  an owner.
* `using` does not tell whether someone else holds the device. Use `owner` for that.
  For an administrator, `using` is `true` for every device that has an owner.
* `claimed` is `true` for up to 2 minutes after the owner reboots the device with
  `keepOwnership`, or after a device in use disappears when the processor runs with
  `--auto-restore-owner`. The 2 minutes start when the reboot is requested, or when the device
  goes away. A device with an automation lease is never claimed. The owner gets the device
  back with the same `usage` and timeout that the reservation had before. While `claimed` is
  `true`, `POST /api/v1/user/devices` and the coordinator refuse the device for everyone,
  including the owner it is kept for. The web UI does not check `claimed`. See
  [Available](#available-available).
* `bookable` is not a device field. It is a group class. `GET /api/v1/devices?target=bookable`
  lists the devices whose origin group is a group you subscribe to and whose current group is not
  of class `standard`. It does not check the class of the origin group.

## `status` values

The provider reads the `adb` state of each device and stores it as a number.

| Value | Name | `adb` state | Meaning |
| ----- | ---- | ----------- | ------- |
| 1 | offline | `offline` | `adb` sees the device but cannot talk to it. |
| 2 | unauthorized | `unauthorized` | The device has not accepted the `adb` key of the provider. |
| 3 | online | `device` or `emulator` | `adb` can use the device. |
| 4 | connecting | `connecting` | `adb` is still connecting to the device. |
| 5 | authorizing | `authorizing` | `adb` is still checking its key with the device. |

The provider starts a device worker only when the state is `device` or `emulator`. Other `adb`
states, such as `recovery`, `sideload` or `bootloader`, have no STF status. The device cannot be
used until `adb` reports it as `device` again. The provider does not handle these states fully: a
device first seen in one of them is not registered, and an online device that changes to one of
them keeps its worker. If that happens, restart the provider once the device is back.

Without a worker, the device sends no heartbeat. When an online device changes to one of the
states in the table, the provider stops its worker and marks the device absent. A device that is
never online is marked
absent when the heartbeat timeout expires. So the device list shows **Offline** or
**Unauthorized** only for a short time. After that it shows **Disconnected**. To see the real
state, run `adb devices` on the provider host.

## States in the device list

The web UI checks these conditions in order. The first one that matches gives the state.

| State | Label | Condition |
| ----- | ----- | --------- |
| `absent` | Disconnected | `present` is `false` |
| `offline` | Offline | `status` is 1 |
| `unauthorized` | Unauthorized | `status` is 2 |
| `present` | Connected | `status` is anything other than 1, 2 or 3 |
| `preparing` | Preparing | `status` is 3 and `ready` is `false` |
| `automation` | Automated | `owner` is set and `usage` is `"automation"` |
| `using` | Using | `using` is `true` |
| `busy` | Busy | `owner` is set |
| `available` | Available | none of the above |

The button in the device list shows **Use** for an available device and **Stop Using** for a
device you are using. The [Prometheus metrics](METRICS.md) use the same states, except `using`
and `automation`.

### Disconnected (`absent`)

* **Cause:** the device was unplugged, ran out of power or lost USB debugging. The provider
  stopped or lost its connection. The device left the `device` state in `adb` (see above).
* **What to do:** run `adb devices` on the provider host. If the device is not listed, check the
  cable, the hub and the provider process. If it is listed as `unauthorized` or `offline`, follow
  the steps for that state. See also the
  [troubleshooting section](../README.md#a-device-that-was-previously-connected-no-longer-shows-up-in-the-list)
  of the README.

### Offline (`offline`)

* **Cause:** `adb` lost the connection to the device. Common reasons are a bad cable, a weak USB
  connection, a hub without enough power or a device that is rebooting.
* **What to do:** wait a few seconds if the device is rebooting. Otherwise reconnect the device,
  or try another cable, port or hub.

### Unauthorized (`unauthorized`)

* **Cause:** the device did not accept the `adb` key of the provider host. This happens with a new
  device, after USB debugging authorizations were revoked, or when the provider host has a new
  `adb` key.
* **What to do:** accept the "Allow USB debugging?" dialog on the device. Select "Always allow from
  this computer". If the dialog does not appear, unplug and plug the device back in.

### Connected (`present`)

* **Cause:** `adb` is still connecting to the device or checking its key.
* **What to do:** wait. If it does not change, reconnect the device.

### Preparing (`preparing`)

* **Cause:** the device worker is starting. It installs the STF services and starts the screen
  capture. The device becomes available when the worker is ready.
* **What to do:** wait. If the device stays in this state, read the provider logs. The provider
  restarts a worker that crashes.

### Automated (`automation`)

* **Cause:** a client reserved the device through the API, for example a test run or the
  [coordinator](coordinator.md).
* **What to do:** you can watch the device but not control it. Wait until the client releases it.
  An administrator can release it with **Stop Automation**, unless it has an automation lease
  (`automationLeaseId` is set). The coordinator and any API client that passes a `leaseId` create
  one. Such a device is released by the client that holds the lease, when the lease expires or
  when the device goes away.

### Using (`using`)

* **Cause:** you hold the device. For an administrator, every device with an owner shows as
  Using, except a device reserved through the API. That one shows as Automated.
* **What to do:** select **Stop Using** when you are done, so other users can take the device.

### Busy (`busy`)

* **Cause:** another user holds the device.
* **What to do:** wait, or contact the owner. Their name in the list links to their profile.
  A device is released when its owner stops using it, or when it is inactive for longer than its
  timeout. The default timeout is the provider `--group-timeout`, 900 seconds.

### Available (`available`)

* **Cause:** the device is ready and nobody holds it.
* **What to do:** select **Use**.

A `claimed` device also shows as Available, and its **Use** button works. The web UI does not
check the claim, so any user can take the device there, and that ends the claim. Only
`POST /api/v1/user/devices` and the coordinator respect the claim. They refuse the device for
everyone, including the owner it is kept for. When the device is ready again, the processor gives
it back to its owner, and the claim ends. If that fails, the claim stays until it expires.

## Why a device was taken from you

When you lose a device on the control page, STF shows the likely reason.

| Reason | Message |
| ------ | ------- |
| `ungroup_request` | You (or someone else) kicked the device. |
| `owner_change` | Someone stole your device. |
| `automatic_timeout` | Device was kicked by automatic timeout. |
| `device_absent` | Device is not present anymore for some reason. |
| `status_change` | Device is present but offline. |
| `automation_release` | Unknown reason. |

`automation_release` means that the client holding the automation lease released the device. The
web UI has no message for it, so it shows "Unknown reason."

## Reserving a device through the API

`POST /api/v1/user/devices` reserves a device only when all of these are true:

* `present` is `true`
* `ready` is `true`
* `owner` is `null`
* `using` is `false`
* `claimed` is `false`

Otherwise the API answers `403` with "Device is being used or not available". The web UI also
requires `status` to be 3. Do the same in your client. Ask for the fields you need, for example
`GET /api/v1/devices/{serial}?fields=serial,present,status,ready,owner,using,claimed`.

After a reboot through `POST /api/v1/user/devices/{serial}/reboot`, poll the device until
`present` and `ready` are `true` again.

## iOS devices

The [iOS provider](ios-provider.md) registers an iPhone only when its runtime is ready.
A registered iPhone always has `status` 3, so it never shows as Offline or Unauthorized.
When the runtime stops being ready, the provider marks the iPhone absent. An iPhone that was
never ready has no device record yet.

The `ios` field tells what the runtime is doing. It keeps updating while the iPhone is absent,
so it tells why the iPhone is gone. The web UI shows the reason as a badge on the device and in
the **iPhone status** card when the reason is not `ready`.

### `ios.phase`

The runtime goes through these phases in order. When a phase fails, `phase` stays at that step
and `reason` tells what went wrong. The runtime then retries from the start.

| Phase | Meaning |
| ----- | ------- |
| `checking_usb` | Looking for the iPhone on USB. |
| `pairing` | Reading device information. This needs a trusted pairing. |
| `tunnel` | Waiting for the USB tunnel. |
| `mounting` | Mounting the developer disk image. |
| `wda` | Starting WebDriverAgent (WDA). |
| `session` | Opening a WDA session. |
| `ready` | The iPhone can be used. `reason` can still carry a warning. |
| `recovering` | The WDA session could not be restored, or a restart or power off was accepted. The runtime starts again. |
| `stopped` | The runtime stopped. |

### `ios.reason`

| Reason | Meaning and what to do |
| ------ | ---------------------- |
| `ready` | No problem. |
| `disconnected` | The iPhone is not on USB. Connect it. |
| `trust_required` | Unlock the iPhone and confirm Trust This Computer. |
| `locked` | The iPhone is locked. It stays present. Open control and use **Unlock screen**. |
| `developer_mode_required` | Enable Developer Mode in Settings, Privacy & Security. |
| `wda_missing` | Install the signed WDA runner on the iPhone. |
| `wda_profile_expired` | The WDA profile expired. Rebuild and reinstall WDA. |
| `wda_profile_expiring` | The WDA profile expires within 48 hours. Prepare a newly signed WDA. |
| `wda_profile_unknown` | The WDA signing profile could not be identified. |
| `tunnel_unavailable` | The USB tunnel is not available yet. |
| `image_mount_failed` | The developer disk image could not be mounted. |
| `wda_unavailable` | WDA is restarting. Check that the iPhone is unlocked and trusts the developer. |
| `recovering` | The runtime is preparing the iPhone. Wait. |
| `provider_unavailable` | The runtime is stopped, restarting the iPhone or cannot be reached. |

See [Health, signing and recovery](ios-provider.md#health-signing-and-recovery) for how to renew
WDA.
