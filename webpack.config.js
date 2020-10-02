var _ = require('lodash')

var webpack = require('webpack')
//var CommonsChunkPlugin = require('webpack/lib/optimize/CommonsChunkPlugin')
var ProgressPlugin = require('webpack/lib/ProgressPlugin')

var pathutil = require('./lib/util/pathutil')
var path = require('path')
var log = require('./lib/util/logger').createLogger('webpack:config')

require("@babel/register");

module.exports = {
  mode: 'development',
  context: __dirname,
  cache: true,
  entry: {
    app: pathutil.resource('app/app.js'),
    authldap: pathutil.resource('auth/ldap/scripts/entry.js'),
    authmock: pathutil.resource('auth/mock/scripts/entry.js')
  },
  output: {
    path: pathutil.resource('build'),
    //path: '/tmp/build/res/build',
    publicPath: '/static/app/build/',
    filename: 'entry/[name].entry.js',
    chunkFilename: '[id].[hash].chunk.js'
  },
  stats: {
    colors: true
  },
  
  resolve: {
    modules: [
      "node_modules", 
      //path.resolve(__dirname, "bower_modules"),  // works
      path.join(__dirname, "res/web_modules" ), // works
      '/tmp/build/bower_modules',
      
      //'/tmp/build/res/web_modules',
      path.resolve(__dirname, "res/app/components" )// works
      //'/tmp/build/res/app/components'
    ],
    /*root: [
      pathutil.resource('app/components')
    ],
    modulesDirectories: [
      'web_modules',
      'bower_components',
      'node_modules'
    ],*/
    alias: {
      'angular-bootstrap': 'angular-bootstrap/ui-bootstrap-tpls',
      localforage: 'localforage/dist/localforage.js',
      'socket.io': 'socket.io-client',
      stats: 'stats.js/src/Stats.js',
      'underscore.string': 'underscore.string/index',
      'ngRoute': 'angular-route',
      'spin.js': '/tmp/build/bower_modules/spin.js/spin.ts',
      'ng-epoch': '/tmp/build/bower_modules/ng-epoch/ng-epoch.js',
      'd3': '/tmp/build/bower_modules/d3/d3.min.js',
      'oboe': '/tmp/build/bower_modules/oboe/dist/oboe-browser.js'
    }
  },
  module: {
    rules: [
      {test: /\.css$/, loader: 'style-loader!css-loader'},
      {
        test: /\.(sass|scss)$/,
        use: ['style-loader','css-loader','sass-loader']
      },
      {test: /\.less$/, loader: 'style-loader!css-loader!less-loader'},
      //, {test: /\.json$/, loader: 'json-loader'}
      {test: /\.jpg$/, loader: 'url-loader', options: { limit: 1000, mimetype: 'image/jpeg' } },
      {test: /\.png$/, loader: 'url-loader', options: { limit: 1000, mimetype: 'image/png' } },
      {test: /\.gif$/, loader: 'url-loader', options: { limit: 1000, mimetype: 'image/gif' } },
      {
        test: /\.(woff|woff2|otf|ttf|svg|eot)$/,
        use: {
          loader: 'url-loader',
          options: { 
            limit: 1,
            name: "fonts/[name].[ext]",
            esModule: false
          }
        }
      },
      {test: /\.pug$/, loader: 'template-html-loader?engine=jade'}
      , {test: /\.html$/, loader: 'html-loader'}
      , {test: /\/angular\.js$/, loader: 'exports-loader?angular'}
      , {test: /angular-cookies\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /angular-route\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /angular-touch\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /angular-animate\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /angular-growl\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /angular-gettext\.js$/, loader: 'imports-loader?angular=angular'}
      , {test: /dialogs\.js$/, loader: 'script-loader'}
      , {test: /epoch\.js$/, loader: 'imports-loader?d3=d3'}
      //, {test: /\.ts$/, loader: 'ng-annotate-loader?ngAnnotate=ng-annotate-patched!ts-loader`
      , {
        test: /\.js$/,
        use: {
          loader: 'ng-annotate-loader',
          options: {
            ngAnnotate: 'ng-annotate-patched',
            es6: true,
            explicityOnly: false
          }
        },
        exclude: /node_modules/
      }
      , {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader'
        },
        exclude: /node_modules/
      }
      , {
        test: /\.jsx$/,
        use: {
          loader: 'babel-loader',
          options: {
            "presets": [
              "@babel/preset-env"
            ],
            "plugins": [
              "@babel/plugin-proposal-class-properties",
              "@babel/plugin-proposal-private-methods"
            ]
          }
        },
        exclude: /node_modules/
      }        
    ],
    // TODO: enable when its sane
    // preLoaders: [
    //  {
    //    test: /\.js$/,
    //    exclude: /node_modules|bower_components/,
    //    loader: 'eslint-loader'
    //  }
    // ],
    noParse: [
      pathutil.resource('bower_modules')
    ]
  },
  plugins: [
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
