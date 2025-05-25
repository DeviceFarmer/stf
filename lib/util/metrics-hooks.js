/**
 * Copyright © 2025 STF Metrics Hooks - Licensed under the Apache license 2.0
 *
 * Hooks to update metrics in real-time when entities change
 */

const metrics = require('./metrics')
const logger = require('./logger')
const log = logger.createLogger('metrics-hooks')

class MetricsHooks {
  static onDeviceAdded() {
    // Increment total devices counter
    metrics.metrics.totalDevices.inc()
    log.debug('Device added')
  }

  static onDeviceRemoved() {
    // Decrement total devices counter
    metrics.metrics.totalDevices.dec()
    log.debug('Device removed')
  }

  static onDeviceStatusChanged(device) {
    // Update device status metrics
    try {
      const previousStatus = device.previousStatus || 'offline';
      let newStatus = 'offline';
      if (device.present) {
        newStatus = device.owner ? 'busy' : 'available';
      }
      // Update metrics if the status has changed
      if (previousStatus !== newStatus) {
        // Decrement the count for the previous status
        metrics.metrics.devicesByStatus.dec({ status: previousStatus });
        // Increment the count for the new status
        metrics.metrics.devicesByStatus.inc({ status: newStatus });
        log.debug('Device status changed:', device.serial, 'from:', previousStatus, 'to:', newStatus);
      }
    }
    catch (error) {
      log.error('Error updating device status metrics:', error);    }
  }

  static onUserAdded() {
    // Increment total users counter
    metrics.metrics.totalUsers.inc()
    log.debug('User added')
  }

  static onUserRemoved() {
    // Decrement total users counter
    metrics.metrics.totalUsers.dec()
    log.debug('User removed')
  }

  static onGroupAdded() {
    // Increment total groups counter
    metrics.metrics.totalGroups.inc()
    log.debug('Group added')
  }

  static onGroupRemoved() {
    // Decrement total groups counter
    metrics.metrics.totalGroups.dec()
    log.debug('Group removed')
  }

  static onGroupStatusChanged(group, oldStatus, newStatus) {
    // Update group status metrics
    try {
      if (oldStatus !== newStatus) {
        // Decrement old status
        if (oldStatus === 'active') {
          metrics.metrics.activeGroups.dec()
        }
 else if (oldStatus === 'ready') {
          metrics.metrics.readyGroups.dec()
        }
 else if (oldStatus === 'pending') {
          metrics.metrics.pendingGroups.dec()
        }

        // Increment new status
        if (newStatus === 'active') {
          metrics.metrics.activeGroups.inc()
        }
 else if (newStatus === 'ready') {
          metrics.metrics.readyGroups.inc()
        }
 else if (newStatus === 'pending') {
          metrics.metrics.pendingGroups.inc()
        }

        log.debug('Group status changed:', group.id, 'from:', oldStatus, 'to:', newStatus)
      }
    }
 catch (error) {
      log.error('Error updating group status metrics:', error)
    }
  }

  static updateUserQuota(userEmail, quotaType, consumed, allocated) {
    // Update user quota metrics
    try {
      metrics.updateUserQuota(userEmail, quotaType, consumed, allocated)
      log.debug('User quota updated:', userEmail, quotaType, consumed, '/', allocated)
    }
 catch (error) {
      log.error('Error updating user quota metrics:', error)
    }
  }
}

module.exports = MetricsHooks
