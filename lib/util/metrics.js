/**
 * Copyright © 2025 STF Metrics Module - Licensed under the Apache license 2.0
 *
 * Prometheus metrics collection for STF (Smartphone Test Farm)
 */

const client = require('prom-client')
const logger = require('./logger')

const log = logger.createLogger('metrics')

// Create a Registry which registers the metrics
const register = new client.Registry()

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'stf'
})

// Enable the collection of default metrics
client.collectDefaultMetrics({register})

// Define custom metrics
const metrics = {
  // Device related metrics
  totalDevices: new client.Gauge({
    name: 'stf_devices_total'
    , help: 'Total number of devices in the system'
    , registers: [register]
  })

  , totalProviders: new client.Gauge({
    name: 'stf_providers_total'
    , help: 'Total number of device providers'
    , registers: [register]
  })

  , usableDevices: new client.Gauge({
    name: 'stf_devices_usable'
    , help: 'Number of devices available for use'
    , registers: [register]
  })

  , busyDevices: new client.Gauge({
    name: 'stf_devices_busy'
    , help: 'Number of devices currently in use'
    , registers: [register]
  })

  // User related metrics
  , totalUsers: new client.Gauge({
    name: 'stf_users_total'
    , help: 'Total number of users in the system'
    , registers: [register]
  })

  // Group related metrics
  , totalGroups: new client.Gauge({
    name: 'stf_groups_total'
    , help: 'Total number of groups in the system'
    , registers: [register]
  })

  , activeGroups: new client.Gauge({
    name: 'stf_groups_active'
    , help: 'Number of active groups'
    , registers: [register]
  })

  , readyGroups: new client.Gauge({
    name: 'stf_groups_ready'
    , help: 'Number of ready groups'
    , registers: [register]
  })

  , pendingGroups: new client.Gauge({
    name: 'stf_groups_pending'
    , help: 'Number of pending groups'
    , registers: [register]
  })

  // Additional operational metrics
  , devicesByStatus: new client.Gauge({
    name: 'stf_devices_by_status'
    , help: 'Number of devices by status'
    , labelNames: ['status']
    , registers: [register]
  })

  , userQuotaUsage: new client.Gauge({
    name: 'stf_user_quota_usage_percent'
    , help: 'User quota usage percentage'
    , labelNames: ['user', 'quota_type']
    , registers: [register]
  })
}

// Helper functions to update metrics
function updateDeviceMetrics(deviceData) {
  if (typeof deviceData.total === 'number') {
    metrics.totalDevices.set(deviceData.total)
  }
  if (typeof deviceData.usable === 'number') {
    metrics.usableDevices.set(deviceData.usable)
  }
  if (typeof deviceData.busy === 'number') {
    metrics.busyDevices.set(deviceData.busy)
  }
  if (typeof deviceData.providers === 'number') {
    metrics.totalProviders.set(deviceData.providers)
  }
  if (deviceData.byStatus) {
    Object.keys(deviceData.byStatus).forEach(status => {
      metrics.devicesByStatus.set({status}, deviceData.byStatus[status])
    })
  }
  log.debug('Updated device metrics', deviceData)
}

function updateUserMetrics(userData) {
  if (typeof userData.total === 'number') {
    metrics.totalUsers.set(userData.total)
  }
  log.debug('Updated user metrics', userData)
}

function updateGroupMetrics(groupData) {
  if (typeof groupData.total === 'number') {
    metrics.totalGroups.set(groupData.total)
  }
  if (typeof groupData.active === 'number') {
    metrics.activeGroups.set(groupData.active)
  }
  if (typeof groupData.ready === 'number') {
    metrics.readyGroups.set(groupData.ready)
  }
  if (typeof groupData.pending === 'number') {
    metrics.pendingGroups.set(groupData.pending)
  }
  log.debug('Updated group metrics', groupData)
}

function updateUserQuota(user, quotaType, consumed, allocated) {
  if (allocated > 0) {
    const percentage = (consumed / allocated) * 100
    metrics.userQuotaUsage.set({user, quota_type: quotaType}, percentage)
  }
}

// Export the register and helper functions
module.exports = {
  register
  , metrics
  , updateDeviceMetrics
  , updateUserMetrics
  , updateGroupMetrics
  , updateUserQuota
  
  // Export the prom-client for advanced usage
  , client
}
