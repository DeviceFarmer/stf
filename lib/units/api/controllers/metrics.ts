/**
* Copyright © 2026 Matan Baruch <matan.baruch@unity3d.com> - Licensed under the Apache license 2.0
**/

import Promise from 'bluebird'

import dbapi from '../../../db/api.js'
import apiutil from '../../../util/apiutil.js'
import metrics from '../../../util/metrics.js'
import type {Response} from 'express'
import type {ApiRequest} from '../../../types/units-api.js'

// Counters are computed on scrape rather than on a timer, so that the returned values are always
// the ones of the very moment the Prometheus server asked for them
function getMetrics(req: ApiRequest, res: Response) {
  // The admin tag of the operation is only enforced by the security handler on the access token
  // authentication path, not on the browser session one, hence this explicit check
  if (req.user.privilege === apiutil.USER) {
    apiutil.respond(res, 403, 'Forbidden: privileged operation (admin)')
    return
  }

  Promise.all([
    dbapi.getDevices()
  , dbapi.getUsers()
  , dbapi.getGroups()
  ])
  .then(function(results) {
    metrics.update(results[0], results[1], results[2])
    return metrics.register.metrics()
  })
  .then(function(body) {
    res.set('Content-Type', metrics.register.contentType)
    res.status(200).send(body)
  })
  .catch(function(err) {
    apiutil.internalError(res, 'Failed to get metrics: ', err.stack)
  })
}

export {
  getMetrics
}
