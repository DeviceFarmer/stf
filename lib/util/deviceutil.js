/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var deviceutil = module.exports = Object.create(null)

// How long a device is held for its owner once it disappears, long enough for a reboot to finish
deviceutil.OWNER_CLAIM_TIMEOUT = 120000

deviceutil.isOwnedByUser = function(device, user) {
  return device.present &&
         device.ready &&
         device.owner &&
         (device.owner.email === user.email || user.privilege === 'admin') &&
         device.using
}

deviceutil.isAddable = function(device) {
  return device.present &&
         device.ready &&
         !device.using &&
         !device.owner &&
         // Held for whoever is coming back to it: ready and unowned, but not free
         !device.claimed
}

// The half of a claim that can be judged from the device row alone, without loading the user it
// names. A claim that fails this can never be honoured, so it is not holding the device either.
deviceutil.isClaimLive = function(device, now) {
  var claim = device && device.restoreOwner

  if (!claim) {
    return false
  }

  // Someone won the race to take the device while it was coming back
  if (device.owner) {
    return false
  }

  // Negated so that a missing or unparseable expiresAt refuses rather than restores
  if (!(claim.expiresAt > now)) {
    return false
  }

  // The device can be moved out of its group, and its group dropped, while it is away
  return Boolean(device.group && device.group.id)
}

// A device that leaves while someone is using it is usually rebooting, so the processor records a
// claim on the row. The claim is only honoured if it would still be allowed as a fresh request.
deviceutil.isRestorable = function(device, user, now) {
  if (!user || !deviceutil.isClaimLive(device, now)) {
    return false
  }

  var subscribed = user.groups && user.groups.subscribed || []

  return subscribed.indexOf(device.group.id) >= 0
}
