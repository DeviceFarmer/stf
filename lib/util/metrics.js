/**
* Copyright © 2026 Matan Baruch <matan.baruch@unity3d.com> - Licensed under the Apache license 2.0
**/

const client = require('prom-client')

const apiutil = require('./apiutil')
const wire = require('../wire')

const metrics = Object.create(null)

// Aggregate device states, computed the same way as the device list does in
// res/app/components/stf/device/enhance-device/enhance-device-service.js; the 'using' and
// 'automation' states are not computed here since they only make sense for a given user session
metrics.DEVICE_STATES = [
  'absent'
, 'present'
, 'offline'
, 'unauthorized'
, 'preparing'
, 'available'
, 'busy'
]

metrics.GROUP_STATES = [apiutil.PENDING, apiutil.READY, apiutil.WAITING]
metrics.GROUP_CLASSES = Object.keys(apiutil.CLASS_DURATION)
metrics.USER_PRIVILEGES = [apiutil.ROOT, apiutil.ADMIN, apiutil.USER]

const register = new client.Registry()

register.setDefaultLabels({app: 'stf'})
client.collectDefaultMetrics({register: register})

const gauges = {
  devicesTotal: new client.Gauge({
    name: 'stf_devices_total'
  , help: 'Number of devices known to STF, whether they are present or not'
  , registers: [register]
  })
, devicesByState: new client.Gauge({
    name: 'stf_devices_by_state'
  , help: 'Number of devices per aggregate device state'
  , labelNames: ['state']
  , registers: [register]
  })
, devicesAvailable: new client.Gauge({
    name: 'stf_devices_available'
  , help: 'Number of devices in the available state'
  , registers: [register]
  })
, devicesBusy: new client.Gauge({
    name: 'stf_devices_busy'
  , help: 'Number of devices in the busy state'
  , registers: [register]
  })
, providersTotal: new client.Gauge({
    name: 'stf_providers_total'
  , help: 'Number of distinct providers serving at least one present device'
  , registers: [register]
  })
, usersTotal: new client.Gauge({
    name: 'stf_users_total'
  , help: 'Number of users known to STF'
  , registers: [register]
  })
, usersByPrivilege: new client.Gauge({
    name: 'stf_users_by_privilege'
  , help: 'Number of users per privilege'
  , labelNames: ['privilege']
  , registers: [register]
  })
, groupsTotal: new client.Gauge({
    name: 'stf_groups_total'
  , help: 'Number of groups known to STF'
  , registers: [register]
  })
, groupsActive: new client.Gauge({
    name: 'stf_groups_active'
  , help: 'Number of groups which are currently active'
  , registers: [register]
  })
, groupsByState: new client.Gauge({
    name: 'stf_groups_by_state'
  , help: 'Number of groups per group state'
  , labelNames: ['state']
  , registers: [register]
  })
, groupsByClass: new client.Gauge({
    name: 'stf_groups_by_class'
  , help: 'Number of groups per group class'
  , labelNames: ['class']
  , registers: [register]
  })
}

function zeroFill(values) {
  return values.reduce(function(counts, value) {
    counts[value] = 0
    return counts
  }, Object.create(null))
}

// Counts only the already known label values so that a corrupted database row can't create an
// unbounded number of time series
function count(counts, value) {
  const current = counts[value]

  if (typeof current === 'number') {
    counts[value] = current + 1
  }
}

function setLabeled(gauge, label, counts) {
  gauge.reset()
  Object.keys(counts).forEach(function(value) {
    const labels = Object.create(null)

    labels[label] = value
    gauge.set(labels, counts[value])
  })
}

metrics.deviceState = function(device) {
  if (!device.present) {
    return 'absent'
  }
  switch (device.status) {
    case wire.DeviceStatus.OFFLINE:
      return 'offline'
    case wire.DeviceStatus.UNAUTHORIZED:
      return 'unauthorized'
    case wire.DeviceStatus.ONLINE:
      if (!device.ready) {
        return 'preparing'
      }
      return device.owner ? 'busy' : 'available'
    default:
      return 'present'
  }
}

metrics.aggregateDevices = function(devices) {
  const stats = {
    total: devices.length
  , available: 0
  , busy: 0
  , providers: 0
  , byState: zeroFill(metrics.DEVICE_STATES)
  }
  const providers = Object.create(null)

  devices.forEach(function(device) {
    const state = metrics.deviceState(device)

    count(stats.byState, state)

    if (state === 'available') {
      stats.available += 1
    }
    if (state === 'busy') {
      stats.busy += 1
    }
    if (device.present && device.provider && device.provider.name) {
      providers[device.provider.name] = true
    }
  })
  stats.providers = Object.keys(providers).length
  return stats
}

metrics.aggregateUsers = function(users) {
  const stats = {
    total: users.length
  , byPrivilege: zeroFill(metrics.USER_PRIVILEGES)
  }

  users.forEach(function(user) {
    count(stats.byPrivilege, user.privilege)
  })
  return stats
}

metrics.aggregateGroups = function(groups) {
  const stats = {
    total: groups.length
  , active: 0
  , byState: zeroFill(metrics.GROUP_STATES)
  , byClass: zeroFill(metrics.GROUP_CLASSES)
  }

  groups.forEach(function(group) {
    if (group.isActive) {
      stats.active += 1
    }
    count(stats.byState, group.state)
    count(stats.byClass, group.class)
  })
  return stats
}

metrics.update = function(devices, users, groups) {
  const deviceStats = metrics.aggregateDevices(devices)
  const userStats = metrics.aggregateUsers(users)
  const groupStats = metrics.aggregateGroups(groups)

  gauges.devicesTotal.set(deviceStats.total)
  gauges.devicesAvailable.set(deviceStats.available)
  gauges.devicesBusy.set(deviceStats.busy)
  gauges.providersTotal.set(deviceStats.providers)
  setLabeled(gauges.devicesByState, 'state', deviceStats.byState)

  gauges.usersTotal.set(userStats.total)
  setLabeled(gauges.usersByPrivilege, 'privilege', userStats.byPrivilege)

  gauges.groupsTotal.set(groupStats.total)
  gauges.groupsActive.set(groupStats.active)
  setLabeled(gauges.groupsByState, 'state', groupStats.byState)
  setLabeled(gauges.groupsByClass, 'class', groupStats.byClass)
}

metrics.register = register
metrics.gauges = gauges

module.exports = metrics
