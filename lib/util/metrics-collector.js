/**
 * Copyright © 2025 STF Metrics Collector - Licensed under the Apache license 2.0
 *
 * Service for collecting STF metrics from database and external sources
 */

const logger = require('./logger')
const dbapi = require('../db/api')
const metrics = require('./metrics')

const log = logger.createLogger('metrics-collector')

class MetricsCollector {
  constructor(options = {}) {
    this.interval = options.interval || 30000 // 30 seconds default
    this.timer = null
    this.isRunning = false
  }

  start() {
    if (!this.isRunning) {
      log.info('Starting metrics collection with interval:', this.interval + 'ms')
      this.isRunning = true
      this.collectMetrics() // Collect immediately
      this.timer = setInterval(() => this.collectMetrics(), this.interval)
    }
  }

  stop() {
    if (this.isRunning) {
      log.info('Stopping metrics collection')
      this.isRunning = false
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  async collectMetrics() {
    try {
      log.debug('Collecting metrics...')
      
      const [
        deviceData
        , userData
        , groupData
      ] = await Promise.all([
        this.collectDeviceMetrics()
        , this.collectUserMetrics()
        , this.collectGroupMetrics()
      ])

      // Update the metrics
      metrics.updateDeviceMetrics(deviceData)
      metrics.updateUserMetrics(userData)
      metrics.updateGroupMetrics(groupData)

      log.debug('Metrics collection completed')
    }
    catch (error) {
      log.error('Error during metrics collection:', error)
    }
  }

  async collectDeviceMetrics() {
    try {
      // Get device statistics from database
      const devices = await dbapi.getDevices()
      
      const deviceStats = {
        total: devices.length
        , usable: devices.filter(d => d.status === 'available' || d.status === 'busy').length
        , busy: devices.filter(d => d.status === 'busy').length
        , providers: new Set(devices.map(d => d.provider && d.provider.name)).size
        , byStatus: {}
      }

      // Count devices by status
      devices.forEach(device => {
        const status = device.status || 'unknown'
        deviceStats.byStatus[status] = (deviceStats.byStatus[status] || 0) + 1
      })

      return deviceStats
    }
    catch (error) {
      log.error('Error collecting device metrics:', error)
      return {
        total: 0
        , usable: 0
        , busy: 0
        , providers: 0
        , byStatus: {}
      }
    }
  }

  async collectUserMetrics() {
    try {
      // Get user statistics from database
      const users = await dbapi.getUsers()
      
      return {
        total: users.length
      }
    }
    catch (error) {
      log.error('Error collecting user metrics:', error)
      return {
        total: 0
      }
    }
  }

  async collectGroupMetrics() {
    try {
      // Get group statistics from database
      const groups = await dbapi.getGroups()
      
      const groupStats = {
        total: groups.length
        , active: groups.filter(g => g.state === 'active').length
        , ready: groups.filter(g => g.state === 'ready').length
        , pending: groups.filter(g => g.state === 'pending').length
      }

      return groupStats
    }
    catch (error) {
      log.error('Error collecting group metrics:', error)
      return {
        total: 0
        , active: 0
        , ready: 0
        , pending: 0
      }
    }
  }

  // Method to collect quota metrics for a specific user
  async collectUserQuotaMetrics(user) {
    try {
      // This would depend on how quotas are implemented in STF
      // For now, return placeholder data
      const quotaTypes = ['devices', 'duration']
      
      quotaTypes.forEach(quotaType => {
        // Example: Get quota usage from database
        const consumed = 0 // Would be actual consumed amount
        const allocated = 10 // Would be actual allocated amount
        
        metrics.updateUserQuota(user, quotaType, consumed, allocated)
      })
    }
    catch (error) {
      log.error('Error collecting user quota metrics:', error)
    }
  }
}

module.exports = MetricsCollector
