//
// Headless CI variant of karma.conf.js: Chrome only, single run, JUnit output.
//

var webpackConfig = require('./../../webpack.config')

module.exports = function(config) {
  config.set({
    frameworks: ['jasmine']
    , files: [
      'helpers/**/*.js'
      , '../app/**/*-spec.js'
    ]

    , preprocessors: {
      'helpers/**/*.js': ['webpack']
      , '../**/*.js': ['webpack']
    }

    , webpack: {
      cache: true
      , module: webpackConfig.webpack.module
      , resolve: webpackConfig.webpack.resolve
    }
    , webpackServer: {
      stats: false
    }

    , reporters: ['dots', 'junit']

    , junitReporter: {
      outputDir: '../../test-results/karma'
      , outputFile: 'junit.xml'
      , useBrowserName: false
      , suite: 'component'
    }

    , autoWatch: false
    , singleRun: true
    , concurrency: 1

    , browsers: ['ChromeHeadlessCI']

    , customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless'
        , flags: [
          '--no-sandbox'
          , '--disable-setuid-sandbox'
          , '--disable-dev-shm-usage'
          , '--disable-gpu'
        ]
      }
    }

    , captureTimeout: 120000
    , browserNoActivityTimeout: 120000
    , browserDisconnectTimeout: 30000
    , browserDisconnectTolerance: 2

    , plugins: [
      require('karma-jasmine')
      , require('karma-webpack')
      , require('karma-chrome-launcher')
      , require('karma-junit-reporter')
    ]
  })
}
