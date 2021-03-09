const path = require('path')

const gulp = require('gulp')
const gutil = require('gulp-util')
const jsonlint = require('gulp-jsonlint')
const eslint = require('gulp-eslint')
const EslintCLIEngine = require('eslint').CLIEngine
const webpack = require('webpack')
const webpackConfig = require('./webpack.config').webpack
const webpackStatusConfig = require('./res/common/status/webpack.config')
const gettext = require('gulp-angular-gettext')
const pug = require('gulp-pug')
const del = require('del')
// const protractor = require('gulp-protractor')
const protractor = require('./res/test/e2e/helpers/gulp-protractor-adv')
const protractorConfig = './res/test/protractor.conf'
const karma = require('karma').server
const karmaConfig = '/res/test/karma.conf.js'
const stream = require('stream')
const run = require('gulp-run')

gulp.task('jsonlint', function () {
  return gulp.src([
      '.bowerrc', '.yo-rc.json', '*.json'
    ])
    .pipe(jsonlint())
    .pipe(jsonlint.reporter())
})

// Try to use eslint-cli directly instead of eslint-gulp
// since it doesn't support cache yet
gulp.task('eslint', function () {
  return gulp.src([
      'lib/**/*.js', 'res/**/*.js', '!res/bower_components/**', '*.js'
    ])
    // eslint() attaches the lint output to the "eslint" property
    // of the file object so it can be used by other modules.
    .pipe(eslint())
    // eslint.format() outputs the lint results to the console.
    // Alternatively use eslint.formatEach() (see Docs).
    .pipe(eslint.format())
    // To have the process exit with an error code (1) on
    // lint error, return the stream and pipe to failAfterError last.
    .pipe(eslint.failAfterError())
})

gulp.task('eslint-cli', function (done) {
  const cli = new EslintCLIEngine({
    cache: true,
    fix: false
  })

  const report = cli.executeOnFiles([
    'lib/**/*.js', 'res/app/**/*.js', 'res/auth/**/*.js', 'res/common/**/*.js', 'res/test/**/*.js', 'res/web_modules/**/*.js', '*.js'
  ])

  const formatter = cli.getFormatter()
  console.log(formatter(report.results))

  if (report.errorCount > 0) {
    done(new gutil.PluginError('eslint-cli', new Error('ESLint error')))
  } else {
    done()
  }
})


gulp.task('lint', ['jsonlint', 'eslint-cli'])
gulp.task('test', ['lint', 'run:checkversion'])
gulp.task('build', ['clean', 'webpack:build'])

gulp.task('run:checkversion', function () {
  gutil.log('Checking STF version...')
  return run('./bin/stf -V').exec()
})

gulp.task('karma_ci', function (done) {
  karma.start({
    configFile: path.join(__dirname, karmaConfig),
    singleRun: true
  }, done)
})

gulp.task('karma', function (done) {
  karma.start({
    configFile: path.join(__dirname, karmaConfig)
  }, done)
})

if (gutil.env.multi) {
  protractorConfig = './res/test/protractor-multi.conf'
} else if (gutil.env.appium) {
  protractorConfig = './res/test/protractor-appium.conf'
}

gulp.task('webdriver-update', protractor.webdriverUpdate)
gulp.task('webdriver-standalone', protractor.webdriverStandalone)
gulp.task('protractor-explorer', function (callback) {
  protractor.protractorExplorer({
    url: require(protractorConfig).config.baseUrl
  }, callback)
})

gulp.task('protractor', ['webdriver-update'], function (callback) {
  gulp.src(['./res/test/e2e/**/*.js'])
    .pipe(protractor.protractor({
      configFile: protractorConfig,
      debug: gutil.env.debug,
      suite: gutil.env.suite
    }))
    .on('error', function (e) {
      console.log(e)

      /* eslint no-console: 0 */
    })
    .on('end', callback)
})

// For piping strings
function fromString(filename, string) {
  const src = new stream.Readable({
    objectMode: true
  })
  src._read = function () {
    this.push(new gutil.File({
      cwd: '',
      base: '',
      path: filename,
      contents: new Buffer(string)
    }))
    this.push(null)
  }
  return src
}


// For production
gulp.task('webpack:build', function (callback) {
  const myConfig = Object.create(webpackConfig)
  myConfig.plugins = myConfig.plugins.concat(
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    })
  )
  myConfig.devtool = false

  webpack(myConfig, function (err, stats) {
    if (err) {
      throw new gutil.PluginError('webpack:build', err)
    }

    gutil.log('[webpack:build]', stats.toString({
      colors: true
    }))

    // Save stats to a json file
    // Can be analyzed in http://webpack.github.io/analyse/
    fromString('stats.json', JSON.stringify(stats.toJson()))
      .pipe(gulp.dest('./tmp/'))

    callback()
  })
})

gulp.task('webpack:others', function (callback) {
  const myConfig = Object.create(webpackStatusConfig)
  myConfig.plugins = myConfig.plugins.concat(
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    })
  )
  myConfig.devtool = false

  webpack(myConfig, function (err, stats) {
    if (err) {
      throw new gutil.PluginError('webpack:others', err)
    }

    gutil.log('[webpack:others]', stats.toString({
      colors: true
    }))
    callback()
  })
})

gulp.task('translate', [
  'translate:extract', 'translate:push', 'translate:pull', 'translate:compile'
])

gulp.task('pug', function () {
  return gulp.src([
      './res/**/*.pug', '!./res/bower_components/**'
    ])
    .pipe(pug({
      locals: {
        // So res/views/docs.pug doesn't complain
        markdownFile: {
          parseContent: function () {}
        }
      }
    }))
    .pipe(gulp.dest('./tmp/html/'))
})

gulp.task('translate:extract', ['pug'], function () {
  return gulp.src([
      './tmp/html/**/*.html', './res/**/*.js', '!./res/bower_components/**', '!./res/build/**'
    ])
    .pipe(gettext.extract('stf.pot'))
    .pipe(gulp.dest('./res/common/lang/po/'))
})

gulp.task('translate:compile', function () {
  return gulp.src('./res/common/lang/po/**/*.po')
    .pipe(gettext.compile({
      format: 'json'
    }))
    .pipe(gulp.dest('./res/common/lang/translations/'))
})

gulp.task('translate:push', function () {
  gutil.log('Pushing translation source to Transifex...')
  return run('tx push -s').exec()
})

gulp.task('translate:pull', function () {
  gutil.log('Pulling translations from Transifex...')
  return run('tx pull').exec()
})

gulp.task('clean', function (cb) {
  del([
    './tmp', './res/build', '.eslintcache'
  ], cb)
})
