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
the reservation through the STF API.

After a test ends in the open viewer, it shows **Automation finished**. Opening
or refreshing a watch link when no test is running shows **View only** instead.
A free device does not stream its screen until you press **Use** to request
manual control. After that request succeeds, the page leaves watch mode and
enables control without a refresh. STF does not acquire the device automatically,
including when another test starts immediately afterwards.

A lost iPhone screen connection shows **Reconnecting…** until a new frame arrives.
Android shows **Screen disconnected**, and an unavailable device shows
**Device offline**. These indicators distinguish a stopped stream from the last
live frame. Intentionally hiding the screen or ending the reservation does not
show a connection warning.

## Access and enforcement

The websocket unit checks the device group, current channel, readiness and
automation state before forwarding manual device commands. Join notifications
block input during the interval before ownership is stored in the database.
Denied transactions receive a cancellation response. Packets waiting on one
device lookup share its pending snapshot and retain their order within that
device channel; the snapshot is discarded after the batch. Ownership, device
and group notifications invalidate an in-flight batch. A slow device does not
block input to another device.

Authorization has bounded queues and a lookup deadline. A stalled or overloaded
connection cancels queued requests and disconnects, so old gestures cannot build
up indefinitely. Reconnect to resume manual control. Ordinary iOS administrator
access within subscribed groups remains available outside automation.

The iOS screen endpoint authenticates the viewer and checks the STF API. A
non-owner must have access to the device group, and the reservation must still
belong to the current automation owner. Periodic checks and ownership changes
end access to that stream.

Android uses its existing minicap transport. The STF viewer stops that stream
when automation ends; the Android transport does not gain the iOS server's
periodic identity and ownership checks in this feature.

See the [recorded Android and iPhone demonstrations](automation-media/README.md).
