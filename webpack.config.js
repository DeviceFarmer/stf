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
    mode: 'production'
    , context: __dirname
    , cache: true
    , entry: {
        app: pathutil.resource('app/src/entries/app.tsx')
        , authldap: pathutil.resource('app/src/entries/auth-ldap.tsx')
        , authmock: pathutil.resource('app/src/entries/auth-mock.tsx')
      }
    , output: {
        path: pathutil.resource('build')
        , publicPath: '/static/app/build/'
        , filename: 'entry/[name].entry.js'
        , chunkFilename: '[id].[contenthash].chunk.js'
        , assetModuleFilename: 'assets/[contenthash][ext]'
    }
    , stats: {
        colors: true
    }
    , performance: {
        hints: false
    }
    , resolve: {
        extensions: ['.tsx', '.ts', '.js', '.json']
        , alias: {
            '@': pathutil.resource('app/src')
        }
    }
    , module: {
        rules: [
          {
            test: /\.[jt]sx?$/i
            , exclude: /node_modules/
            , loader: 'esbuild-loader'
            , options: {
                target: 'es2020'
                , jsx: 'automatic'
                , tsconfig: pathutil.resource('app/tsconfig.json')
            }
          }
          , {
            test: /\.css$/i
            , use: [
                'style-loader'
                , {
                  loader: 'css-loader'
                  , options: {
                      modules: {
                        auto: true
                        , namedExport: false
                        , exportLocalsConvention: 'as-is'
                        , localIdentName: '[name]__[local]--[hash:base64:5]'
                      }
                  }
                }
            ]
          }
          , {test: /\.(jpg|png|gif)$/i
            , type: 'asset'
            , parser: {dataUrlCondition: {maxSize: 1000}}}
          , {test: /\.(svg|eot|woff2?|otf|ttf)$/i, type: 'asset/resource'}
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
      mode: 'development'
      , plugins: [
        new webpack.LoaderOptionsPlugin({
          debug: true
        })
      ]
      , devtool: 'eval-cheap-module-source-map'
      , stats: {
          colors: true
      }
  }
}
