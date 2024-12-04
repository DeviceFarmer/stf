//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

var _ = require('lodash')
var webpack = require('webpack')
var ProgressPlugin = require('webpack/lib/ProgressPlugin')
var pathutil = require('./lib/util/pathutil')
var log = require('./lib/util/logger').createLogger('webpack:config')

module.exports = {
  webpack: {
    mode: 'none'
    , performance: {
        hints: false
      , maxAssetSize: 512000
      }
    , context: __dirname
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
          , 'bower_components'
          , 'node_modules'
        ]
        , descriptionFiles: ['package.json', 'bower.json']
        , extensions: ['.js', '.json']
        , alias: {
            'angular-bootstrap': 'angular-bootstrap/ui-bootstrap-tpls'
            , localforage: 'localforage/dist/localforage.js'
            , stats: 'stats.js/src/Stats.js'
            , 'underscore.string': 'underscore.string/index'
        }
    }
    , module: {
        rules: [
          {test: /\.css$/i, use: ['style-loader', 'css-loader']}
          , {test: /\.scss$/i, use: ['style-loader', 'css-loader', 'sass-loader']}
          , {test: /\.less$/i, use: ['style-loader', 'css-loader', 'less-loader']}
          , {test: /\.(jpg|png|gif)$/i, use: [{loader: 'url-loader', options: {limit: 1000}}]}
          , {test: /\.svg/i
            , use: [{loader: 'url-loader', options: {limit: 1, mimetype: 'image/svg+xml'}}]}
          , {test: /\.eot$/i
            , use: [{loader: 'url-loader', options: {limit: 1, mimetype: 'vnd.ms-fontobject'}}]}
          , {test: /\.(woff|otf|ttf)/i
            , use: [{loader: 'url-loader', options: {limit: '1', mimetype: 'vnd.ms-fontobject'}}]}
          , {test: /\.pug$/i
            , use: [{loader: 'template-html-loader', options: {engine: 'jade'}}]}
          , {test: /\.html$/i, loader: 'html-loader'}
          , {test: /angular\.js$/i
            , use: [{loader: 'exports-loader', options: {type: 'commonjs', exports: 'angular'}}]}
          , {test: /angular-cookies\.js$/i
            , use: [{loader: 'imports-loader', options: {imports: 'angular'}}]}
          , {test: /angular-route\.js$/i
            , use: [{loader: 'imports-loader', options: {imports: 'angular'}}]}
          , {test: /angular-touch\.js$/i
            , use: [{loader: 'imports-loader', options: {imports: 'angular'}}]}
          , {test: /angular-animate\.js$/i
            , use: [{loader: 'imports-loader', options: {imports: 'angular'}}]}
          , {test: /angular-growl\.js$/i
            , use: [{loader: 'imports-loader', options: {imports: 'angular'}}]}
          , {test: /dialogs\.js$/, use: [{loader: 'script-loader'}]}
        ]
    }
    , plugins: [
        new ProgressPlugin(_.throttle(
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
      ]
      , devtool: 'eval'
      , stats: {
          colors: true
      }
  }
}
