import serveStatic from 'serve-static'

import pathutil from '../../../util/pathutil.js'

export default function() {
  return serveStatic(
    pathutil.resource('common/browsers')
  , {
      maxAge: '30d'
    }
  )
}
