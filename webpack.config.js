//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

var _ = require('lodash')
var webpack = require('webpack')
var ProgressPlugin = require('webpack/lib/ProgressPlugin')
var pathutil = require('./lib/util/pathutil')
var log = require('./lib/util/logger').createLogger('webpack:config')

module.exports = {
  webpack: {
    context: __dirname
    , cache: true
    , entry: {
        app: pathutil.resource('app/app.js')
        , authldap: pathutil.resource('auth/ldap/scripts/entry.js')
        , authmock: pathutil.resource('auth/mock/scripts/entry.js')
      }
    , output: {
        path: pathutil.resource('build')
        , publicPath: '/static/app/build/'
        , filename: 'entry/[name].entry.js'
        , chunkFilename: '[id].[hash].chunk.js'
    }
    , stats: {
        colors: true
    }
    , resolve: {
        modules: [
          pathutil.resource('app/components')
          , 'web_modules'
          , 'node_modules'
        ]
        , descriptionFiles: ['package.json']
        , moduleExtensions: ['-loader']
        , extensions: ['.js', '.json']
        , enforceModuleExtension: false
      , alias: {
        '@devicefarmer/adbkit': './adbkit'
        , 'angular-bootstrap': 'angular-bootstrap/ui-bootstrap-tpls'
        , localforage: 'localforage/dist/localforage.js'
        , 'socket.io': 'socket.io-client'
        , stats: 'stats.js/src/Stats.js'
        , 'underscore.string': 'underscore.string/index'
      }
    }
    , module: {
        loaders: [
          {test: /\.css$/, loader: 'style-loader!css-loader'}
          , {test: /\.scss$/, loader: 'style-loader!css-loader!sass-loader'}
          , {test: /\.less$/, loader: 'style-loader!css-loader!less-loader'}
          , {test: /\.json$/, loader: 'json-loader'}
          , {test: /\.jpg$/, loader: 'url-loader?limit=1000&mimetype=image/jpeg'}
          , {test: /\.png$/, loader: 'url-loader?limit=1000&mimetype=image/png'}
          , {test: /\.gif$/, loader: 'url-loader?limit=1000&mimetype=image/gif'}
          , {test: /\.svg/, loader: 'url-loader?limit=1&mimetype=image/svg+xml'}
          , {test: /\.woff/, loader: 'url-loader?limit=1&mimetype=application/font-woff'}
          , {test: /\.otf/, loader: 'url-loader?limit=1&mimetype=application/font-woff'}
          , {test: /\.ttf/, loader: 'url-loader?limit=1&mimetype=application/font-woff'}
          , {test: /\.eot/, loader: 'url-loader?limit=1&mimetype=vnd.ms-fontobject'}
          , {test: /\.pug$/, loader: 'template-html-loader?engine=jade'}
          , {test: /\.html$/, loader: 'html-loader'}
          , {test: /angular\.js$/, loader: 'exports-loader?angular'}
          , {test: /angular-growl\.js$/, loader: 'imports-loader?angular=angular'}
          , {test: /dialogs\.js$/, loader: 'script-loader'}
          , {
            test: /node_modules\/(draggabilly|fizzy-ui-utils|get-size|outlayer|packery|unipointer)/
            , loader: 'imports-loader?define=>false'
          }
        ]
    }
    , plugins: [
        new webpack.optimize.CommonsChunkPlugin({
          name: 'commons.entry'
          , filename: 'entry/commons.entry.js'
        })
        , new ProgressPlugin(_.throttle(
            function(progress, message) {
              var msg
              if (message) {
                msg = message
              }
              else {
                msg = progress >= 1 ? 'complete' : 'unknown'
              }
              log.info('Build progress %d%% (%s)', Math.floor(progress * 100), msg)
            }
            , 1000
        ))
    ]
  }
  , webpackServer: {
      plugins: [
        new webpack.LoaderOptionsPlugin({
          debug: true
        })
        , new webpack.optimize.CommonsChunkPlugin({
            name: 'commons.entry'
            , filename: 'entry/commons.entry.js'
        })
      ]
      , devtool: 'eval'
      , stats: {
          colors: true
      }
  }
}
