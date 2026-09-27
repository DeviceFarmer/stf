import serveStatic from 'serve-static'

import pathutil from '../../../util/pathutil.js'

export default function() {
  return serveStatic(
    pathutil.root('node_modules/@devicefarmer/stf-browser-db/dist')
  , {
      maxAge: '30d'
    }
  )
}
