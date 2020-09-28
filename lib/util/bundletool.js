var cp = require('child_process')
var fs = require('fs')
var path = require('path')
var request = require('request')

var Promise = require('bluebird')
var yauzl = require('yauzl')

var logger = require('./logger')

module.exports = function(options) {
  return new Promise(function(resolve, reject) {
    var log = logger.createLogger('util:bundletool')
    var bundletoolFilePath = options.bundletoolPath
    var bundle = options.file
    var bundlePath = bundle.path
    var outputPath = bundlePath + '.apks'
    var keystore = options.keystore

    function checkIfJava() {
      return new Promise(function(resolve, reject) {
        var check = cp.spawn('java', ['-version'])
        var stderrChunks = []
        check.on('error', function(err) {
            reject(err)
        })
        check.stderr.on('data', function(data) {
          stderrChunks = stderrChunks.concat(data)
        })
        check.stderr.on('end', function() {
          var data = Buffer.concat(stderrChunks).toString().split('\n')[0]
          var regex = new RegExp('(openjdk|java) version')
          var javaVersion = regex.test(data) ? data.split(' ')[2].replace(/"/g, '') : false
          if (javaVersion !== false) {
            resolve(javaVersion)
          }
          else {
            reject(new Error('Java not found'), null)
          }
        })
      })
    }

    function convert() {
      var proc = cp.spawn('java', [
        '-jar'
      , bundletoolFilePath
      , 'build-apks'
      , `--bundle=${bundlePath}`
      , `--output=${outputPath}`
      , `--ks=${keystore.ksPath}`
      , `--ks-pass=pass:${keystore.ksPass}`
      , `--ks-key-alias=${keystore.ksKeyAlias}`
      , `--key-pass=pass:${keystore.ksKeyPass}`
      , '--overwrite'
      , '--mode=universal'
      ])

      proc.on('error', function(err) {
        reject(err)
      })

      proc.on('exit', function(code, signal) {
        if (signal) {
          reject(new Error('Exited with signal ' + signal))
        }
        else if (code === 0) {
          yauzl.open(outputPath, {lazyEntries: true}, function(err, zipfile) {
            if (err) {
              reject(err)
            }
            zipfile.readEntry()
            zipfile.on('entry', function(entry) {
              if (/\/$/.test(entry.fileName)) {
                zipfile.readEntry()
              }
              else {
                zipfile.openReadStream(entry, function(err, readStream) {
                  if (err) {
                    reject(err)
                  }
                  readStream.on('end', function() {
                    zipfile.readEntry()
                  })
                  var filePath = entry.fileName.split('/')
                  var fileName = filePath[filePath.length - 1]
                  var writeStream = fs.createWriteStream(path.join('/tmp/', fileName))
                  writeStream.on('error', function(err) {
                    reject(err)
                  })
                  readStream.pipe(writeStream)
                })
              }
            })
            zipfile.on('error', function(err) {
              reject(err)
            })
            zipfile.once('end', function() {
              fs.renameSync('/tmp/universal.apk', bundlePath)
              fs.readdirSync('/tmp/', function(err, files) {
                if (err) {
                  reject(err)
                }
                for (var file of files) {
                  fs.unlinkSync(path.resolve('/tmp/', file))
                }
                fs.unlinkSync(outputPath)
              })
              log.info('AAB -> APK')
              resolve(bundle)
            })
          })
        }
        else {
          reject(new Error('Exited with status ' + code))
        }
      })
    }

    if (bundle.isAab === true) {
      log.info('AAB detected')
      checkIfJava()
      .then(function() {
        if (!fs.existsSync(keystore.ksPath)) {
          cp.spawnSync('keytool', [
            '-genkey'
          , '-noprompt'
          , '-keystore', keystore.ksPath
          , '-alias', keystore.ksKeyAlias
          , '-keyalg', keystore.ksKeyalg
          , '-keysize', keystore.ksKeysize
          , '-storepass', keystore.ksPass
          , '-keypass', keystore.ksKeyPass
          , '-dname', keystore.ksDname
          , '-validity', keystore.ksValidity
          ])
        }
      })
      .then(function() {
        if(!fs.existsSync(keystore.ksPath)) {
          reject('Keystore not found')
        }
        else if(!fs.existsSync(bundletoolFilePath)) {
          reject('bundletool not found')
        }
        else {
          convert()
        }
      })
      .catch(function(err) {
        reject(err)
      })
    }
    else {
      resolve(bundle)
    }
  })
}
