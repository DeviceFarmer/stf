import {createRequire} from 'module'
import path from 'path'

import {verify} from '../util/depcheck.js'

var require = createRequire(import.meta.url)

verify(path.resolve(import.meta.dirname, '../..'))
require('./index.js')
