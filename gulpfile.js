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

var poDir = './res/common/lang/po'
var potFile = path.join(poDir, 'stf.pot')
var translationsDir = './res/common/lang/translations'

function extractTranslations() {
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

  return extractor
}

function poFiles() {
  return fs.readdirSync(poDir).filter(function(name) {
    return /\.po$/.test(name)
  }).map(function(name) {
    return path.join(poDir, name)
  })
}

// strings is what translations/stf.<language>.json stores under the language
function compileCatalog(file) {
  var gettextParser = require('gettext-parser')
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

  return {language: language, strings: strings, po: po}
}

function catalogFile(language) {
  return path.join(translationsDir, 'stf.' + language + '.json')
}

gulp.task('translate:extract', function(callback) {
  extractTranslations().savePotFile(potFile)
  callback()
})

gulp.task('translate:compile', function(callback) {
  poFiles().forEach(function(file) {
    var catalog = compileCatalog(file)
    var output = {}
    output[catalog.language] = catalog.strings
    fs.writeFileSync(catalogFile(catalog.language), JSON.stringify(output))
  })

  callback()
})

// Fails when stf.pot, the compiled catalogs or langs.json are out of date, or
// when a translation uses a placeholder its source string does not have
gulp.task('translate:check', function(callback) {
  var gettextParser = require('gettext-parser')
  var problems = []

  // Compare messages only, since the #: references move with every code edit
  function messageKey(context, text, textPlural) {
    return JSON.stringify([context || '', text, textPlural || ''])
  }
  var extracted = new Set(extractTranslations().getMessages().map(function(message) {
    return messageKey(message.context, message.text, message.textPlural)
  }))
  var pot = gettextParser.po.parse(fs.readFileSync(potFile)).translations
  var committed = new Set()
  Object.keys(pot).forEach(function(context) {
    Object.keys(pot[context]).filter(Boolean).forEach(function(msgid) {
      committed.add(messageKey(context, msgid, pot[context][msgid].msgid_plural))
    })
  })
  var missing = Array.from(extracted).filter(function(key) {
    return !committed.has(key)
  })
  var stale = Array.from(committed).filter(function(key) {
    return !extracted.has(key)
  })
  if (missing.length || stale.length) {
    problems.push(potFile + ' is out of date, run `gulp translate:extract`' +
      missing.map(function(key) {
        return '\n  missing: ' + JSON.parse(key)[1]
      }).join('') +
      stale.map(function(key) {
        return '\n  no longer in the sources: ' + JSON.parse(key)[1]
      }).join(''))
  }

  function placeholders(text) {
    return (text.match(/\{\{\s*[\w.]+\s*\}\}/g) || []).map(function(placeholder) {
      return placeholder.replace(/[{}\s]/g, '')
    })
  }

  var languages = JSON.parse(fs.readFileSync('./res/common/lang/langs.json'))
  var compiled = new Set()
  poFiles().forEach(function(file) {
    var catalog = compileCatalog(file)
    compiled.add(catalog.language)

    if (!languages[catalog.language]) {
      problems.push(file + ': ' + catalog.language + ' is missing from langs.json')
    }

    var committedCatalog = fs.existsSync(catalogFile(catalog.language)) ?
      JSON.parse(fs.readFileSync(catalogFile(catalog.language)))[catalog.language] :
      undefined
    if (JSON.stringify(committedCatalog) !== JSON.stringify(catalog.strings)) {
      problems.push(catalogFile(catalog.language) + ' does not match ' + file +
        ', run `gulp translate:compile`')
    }

    // An unknown placeholder renders as an empty string
    Object.keys(catalog.po.translations).forEach(function(context) {
      Object.keys(catalog.po.translations[context]).filter(Boolean).forEach(function(msgid) {
        var entry = catalog.po.translations[context][msgid]
        var known = new Set(placeholders(msgid).concat(placeholders(entry.msgid_plural || '')))
        entry.msgstr.forEach(function(msgstr) {
          placeholders(msgstr).filter(function(name) {
            return !known.has(name)
          }).forEach(function(name) {
            problems.push(file + ': unknown placeholder {{' + name + '}} in the translation of "' +
              msgid + '"')
          })
        })
      })
    })
  })

  Object.keys(languages).filter(function(language) {
    return language !== 'en' && !compiled.has(language)
  }).forEach(function(language) {
    problems.push('langs.json lists ' + language + ' but ' + poDir + ' has no catalog for it')
  })

  if (problems.length) {
    problems.forEach(function(problem) {
      gutil.log(gutil.colors.red(problem))
    })
    callback(new gutil.PluginError('translate:check', problems.length + ' translation problem(s)'))
    return
  }
  callback()
})

gulp.task('translate:push', function() {
  gutil.log('Pushing translation source to Transifex...')
  return run('tx push -s').exec()
})

gulp.task('translate:pull', function() {
  gutil.log('Pulling translations from Transifex...')
  // A fresh checkout is newer than Transifex, which tx would otherwise skip
  return run('tx pull --translations --force').exec()
})

gulp.task('clean', function() {
  return deleteAsync([
    './tmp'
    , './res/build'
    , '.eslintcache'
  ])
})

gulp.task('build', gulp.parallel('clean', 'webpack:build'))
gulp.task('lint', gulp.parallel('jsonlint', 'eslint-cli', 'tsc', 'translate:check'))
gulp.task('test', gulp.parallel('lint', 'run:checkversion'))
gulp.task('translate', gulp.series(
  'translate:extract'
, 'translate:push'
, 'translate:pull'
, 'translate:compile'
))
