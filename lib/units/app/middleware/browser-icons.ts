import serveStatic from 'serve-static'

import pathutil from '../../../util/pathutil.js'

export default function() {
  return serveStatic(
    pathutil.resource('common/browser-icons')
  , {
      maxAge: '30d'
    }
  )
}
