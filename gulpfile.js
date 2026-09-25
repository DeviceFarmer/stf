//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

var path = require('path')

var gulp = require('gulp')
var gutil = require('gulp-util')
var jsonlint = require('gulp-jsonlint')
var ESLint = require('eslint').ESLint
var webpack = require('webpack')
var webpackStatusConfig = require('./res/common/status/webpack.config')
var deleteAsync = require('del').deleteAsync
var stream = require('stream')
var run = require('gulp-run')
var fs = require('fs')

gulp.task('jsonlint', function() {
  return gulp.src([
      '.yo-rc.json'
    , '*.json'
    ], {allowEmpty: true})
    .pipe(jsonlint())
    .pipe(jsonlint.reporter())
})

gulp.task('eslint-cli', function() {
  var cli = new ESLint({
    cache: true
  , fix: false
  })

  return cli.lintFiles([
    'lib/**/*.js'
    , 'res/app/src/**/*.{ts,tsx}'
    , 'res/app/*.ts'
    , 'res/common/**/*.js'
    , '*.js'
  ])
    .then(function(results) {
      return Promise.all([results, cli.loadFormatter('stylish')])
    })
    .then(function(both) {
      return Promise.all([both[0], both[1].format(both[0])])
    })
    .then(function(both) {
      console.log(both[1])

      var errorCount = both[0].reduce(function(total, result) {
        return total + result.errorCount
      }, 0)

      if (errorCount > 0) {
        throw new gutil.PluginError('eslint-cli', new Error('ESLint error'))
      }
    })
})

gulp.task('run:checkversion', function() {
  gutil.log('Checking STF version...')
  return run('./bin/stf -V').exec()
})


gulp.task('tsc', function() {
  return run('tsc -p res/app/tsconfig.json').exec()
})

// For piping strings
function fromString(filename, string) {
  var src = new stream.Readable({objectMode: true})
  src._read = function() {
    this.push(new gutil.File({
      cwd: ''
    , base: ''
    , path: filename
    , contents: Buffer.from(string)
    }))
    this.push(null)
  }
  return src
}


// For production
gulp.task('webpack:build', function(callback) {
  var myConfig = require('./webpack.config').webpack

  webpack(myConfig, function(err, stats) {
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


gulp.task('webpack:others', function(callback) {
  var myConfig = Object.create(webpackStatusConfig)
  myConfig.plugins = myConfig.plugins.concat(
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    })
  )
  myConfig.devtool = false

  webpack(myConfig, function(err, stats) {
    if (err) {
      throw new gutil.PluginError('webpack:others', err)
    }

    gutil.log('[webpack:others]', stats.toString({
      colors: true
    }))
    callback()
  })
})

gulp.task('translate:extract', function(callback) {
  var GettextExtractor = require('gettext-extractor').GettextExtractor
  var JsExtractors = require('gettext-extractor').JsExtractors
  var extractor = new GettextExtractor()
  var singular = {arguments: {text: 0}}

  extractor
    .createJsParser([
      JsExtractors.callExpression(['t', 'gettext', 'translate'], singular)
    , JsExtractors.callExpression(['tn', 'translatePlural'], {
        arguments: {text: 1, textPlural: 2}
      })
    ])
    .parseFilesGlob('./res/app/src/**/*.@(ts|tsx)', {
      ignore: ['./res/app/src/**/*.test.@(ts|tsx)']
    })

  extractor.savePotFile('./res/common/lang/po/stf.pot')
  callback()
})

gulp.task('translate:compile', function(callback) {
  var gettextParser = require('gettext-parser')

  var poDir = './res/common/lang/po'
  fs.readdirSync(poDir).filter(function(name) {
    return /\.po$/.test(name)
  }).forEach(function(name) {
    var file = path.join(poDir, name)
    var po = gettextParser.po.parse(fs.readFileSync(file))
    var language = po.headers.Language ||
      path.basename(file, '.po').replace(/^stf\./, '')
    var strings = {}

    Object.keys(po.translations).forEach(function(context) {
      Object.keys(po.translations[context]).forEach(function(msgid) {
        var entry = po.translations[context][msgid]
        var translated = entry.msgstr.filter(Boolean)
        var fuzzy = /\bfuzzy\b/.test(entry.comments && entry.comments.flag || '')
        if (msgid && translated.length && !fuzzy) {
          strings[msgid] = entry.msgid_plural ? entry.msgstr : entry.msgstr[0]
        }
      })
    })

    var output = {}
    output[language] = strings
    fs.writeFileSync(
      path.join('./res/common/lang/translations', 'stf.' + language + '.json')
    , JSON.stringify(output)
    )
  })

  callback()
})

gulp.task('translate:push', function() {
  gutil.log('Pushing translation source to Transifex...')
  return run('tx push -s').exec()
})

gulp.task('translate:pull', function() {
  gutil.log('Pulling translations from Transifex...')
  return run('tx pull').exec()
})

gulp.task('clean', function() {
  return deleteAsync([
    './tmp'
    , './res/build'
    , '.eslintcache'
  ])
})

gulp.task('build', gulp.parallel('clean', 'webpack:build'))
gulp.task('lint', gulp.parallel('jsonlint', 'eslint-cli', 'tsc'))
gulp.task('test', gulp.parallel('lint', 'run:checkversion'))
gulp.task('translate', gulp.series(
  'translate:extract'
, 'translate:push'
, 'translate:pull'
, 'translate:compile'
))
