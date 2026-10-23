import serveStatic from 'serve-static'
import {Router as createRouter} from 'express'

import pathutil from '../../../util/pathutil.js'

export default function() {
  const router = createRouter()
  router.use(serveStatic(pathutil.resource('devices'), {maxAge: '30d'}))
  router.use(serveStatic(
    pathutil.root('node_modules/@devicefarmer/stf-device-db/dist')
  , {
      maxAge: '30d'
    }
  ))
  return router
}
