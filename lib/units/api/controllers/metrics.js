/**
 * Copyright © 2025 STF Metrics Controller - Licensed under the Apache license 2.0
 *
 * Prometheus metrics endpoint controller
 */

// Fix for Node.js versions where util.isError was removed
const util = require('util')
if (!util.isError) {
  util.isError = function(e) {
    return e && typeof e === 'object' && e instanceof Error
  }
}

const metrics = require('../../../util/metrics')
const logger = require('../../../util/logger')
const log = logger.createLogger('api:controllers:metrics')

/**
 * GET /metrics
 *
 * Returns Prometheus metrics in the expected format
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
function getMetrics(req, res) {
  // Set the content type to plain text as expected by Prometheus
  res.set('Content-Type', metrics.register.contentType)
  
  // Return the metrics (handle Promise from prom-client v15+)
  metrics.register.metrics()
    .then(metricsData => {
      res.end(metricsData)
      log.debug('Served Prometheus metrics')
    })
    .catch(error => {
      log.error('Error serving metrics:', error)
      res.status(500).json({
        success: false
        , description: 'Internal server error while fetching metrics'
      })
    })
}

module.exports = {
  getMetrics
}
