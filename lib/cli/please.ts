import {createRequire} from 'module'
import path from 'path'

var require = createRequire(import.meta.url)

require('@devicefarmer/please-update-dependencies')({
  filename: path.resolve(import.meta.dirname, '../../package.json')
, require: require
})
require('./index.js')
