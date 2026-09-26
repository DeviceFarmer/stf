//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import _ from 'lodash'
import webpackModule from 'webpack'
import pathutil from './lib/util/pathutil.js'
import logger from './lib/util/logger.js'

var log = logger.createLogger('webpack:config')

export var webpack: webpackModule.Configuration = {
    mode: 'production'
    , context: import.meta.dirname
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
        new webpackModule.ProgressPlugin(_.throttle(
          function(progress: number, message: string) {
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

export var webpackServer: webpackModule.Configuration = {
      mode: 'development'
      , plugins: [
        new webpackModule.LoaderOptionsPlugin({
          debug: true
        })
      ]
      , devtool: 'eval-cheap-module-source-map'
      , stats: {
          colors: true
      }
}
