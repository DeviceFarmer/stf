import {createRequire} from 'module'
import fs from 'fs'

var require = createRequire(import.meta.url)

var watchers = Object.create(null)

function refresh() {
  process.kill(process.pid, 'SIGHUP')
}

function collect() {
  Object.keys(require.cache).forEach(function(path) {
    if (!watchers[path]) {
      if (path.indexOf('node_modules') === -1) {
        watchers[path] = fs.watch(path, refresh)
      }
    }
  })
}

export default function() {
  collect()
}
