import pathutil from '../../../lib/util/pathutil.js'
import {webpack as options} from '../../../webpack.config.mts'

export default Object.assign({}, options, {
  entry: pathutil.resource('common/status/scripts/entry.ts')
  , output: {
    path: pathutil.resource('build')
    , publicPath: '/static/build/'
    , filename: 'bundle-status.js'
  }
})
