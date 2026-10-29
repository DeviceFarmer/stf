# Viewing automated devices

Devices reserved through `POST /api/v1/user/devices` carry `usage: automation`.
STF shows them as **Automated** and allows users in their device group to watch
without taking ownership or interrupting the test. This works with Android and
iOS devices and with the standalone control view.

## Running a test

1. Reserve the device with the automation account's STF API token. See the
   [device reservation API](API.md#post-userdevices).
2. Run the test through its existing Appium, WDA or ADB connection.
3. Close the test session and release the STF reservation in cleanup, including
   after a failure, using `DELETE /api/v1/user/devices/{serial}`.

The reservation identifies automation; connecting Appium directly without an STF
reservation does not set this status. Screen viewing does not renew the iOS
reservation timeout.

## Watching a session

Open an Automated device from its card, name or status. Its link includes
`?mode=watch`, so opening it in a new tab or refreshing it retains view-only mode,
even if the test finishes before the page loads. STF does not send an ownership
request. Show/hide remains available, and the information pane can be read.
Touch, keyboard, hardware buttons, rotation, uploads and interaction panes are
disabled.

These restrictions also apply when the viewer is the automation owner or an
administrator. The runner continues through its test connection and can release
the reservation through the STF API. Administrators also have a separate,
confirmed **Stop Automation** action on the Devices page and **Release
reservation** in the viewer. The device name or card still opens view-only mode.
These actions release the STF reservation; stop the external Appium session
separately.

After a test ends in the open viewer, it shows **Automation finished**. Opening
or refreshing a watch link when no test is running shows **View only** instead.
A free device does not stream its screen until you press **Use** to request
manual control. After that request succeeds, the page leaves watch mode and
enables control without a refresh. STF does not acquire the device automatically,
including when another test starts immediately afterwards. If you already have
manual access, **Use** leaves watch mode without requesting ownership again.

After a standalone viewer takes manual control, its opener releases that
confirmed reservation when the popup closes. Refreshing the popup keeps the
reservation. Cleanup checks its current owner, reservation ID and device channel,
so it does not release a replacement acquired in another tab. Keep
the opener open for this cleanup; closing the whole browser relies on the usual
server timeout. These conditional releases require the updated provider's
reservation IDs; legacy API release requests remain supported.

A lost iPhone screen connection shows **Reconnecting…** until a new frame arrives.
Android shows **Screen disconnected**, and an unavailable device shows
**Device offline**. These indicators distinguish a stopped stream from the last
live frame. Intentionally hiding the screen or ending the reservation does not
show a connection warning.

## Access and enforcement

The websocket unit checks the device group, current channel, readiness and
automation state before forwarding manual device commands. Join notifications
block input during the interval before ownership is stored in the database.
Denied transactions receive a cancellation response. Validated manual input
permissions are cached for at most 100 ms; ownership, device and group
notifications invalidate them immediately. Reads must agree with observed
permission changes before input resumes. Other device commands are checked
separately and do not reuse cached input permissions. Packets retain their order within each device channel.

Each channel has a bounded queue and a two-second lookup deadline. A stalled
or overloaded channel cancels its pending requests and resets its incomplete
gesture, without disconnecting unrelated devices. Reset messages identify the
old gesture so they cannot cancel a newer owner's input. A fresh gesture can
resume after authorization recovers. Ordinary iOS administrator access within
subscribed groups remains available outside automation. If the connection reaches
its limit for tracking permission changes, it denies further commands; refresh
the page to reconnect after the database catches up.

Run `stf migrate` when upgrading to create the device channel index. Deploy
websocket units and providers from the same build: during a rolling upgrade,
update websocket units first, then release devices and restart their providers.
Protected providers reject touch packets without the acknowledged reservation
and server-generated gesture identity; the browser API remains unchanged.
Gesture queues tolerate reordered transport packets, bound pending prefixes,
and expire sequence gaps without imposing a long-press timeout. Conditional
release requests supply both `reservationId` and `deviceChannel`; they fail if
the reservation changed. The existing unconditional DELETE API remains available
for automation cleanup.

The iOS screen endpoint authenticates the viewer and checks the STF API. A
non-owner must have access to the device group, and the reservation must still
belong to the current automation owner. Periodic checks and ownership changes
end access to that stream.

Android uses its existing minicap transport. The STF viewer stops that stream
when automation ends; the Android transport does not gain the iOS server's
periodic identity and ownership checks in this feature.

See the [recorded Android and iPhone demonstrations](automation-media/README.md).
