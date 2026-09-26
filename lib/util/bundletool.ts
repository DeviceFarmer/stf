/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

// One-shot AAB to APK conversion: keystore generation, tool lookups and temp file cleanup all have to finish before the next step runs.
/* eslint-disable no-sync */

import cp from 'child_process'
import fs from 'fs'
import path from 'path'

import Promise from 'bluebird'
import yauzl from 'yauzl'

import logger from './logger.js'

interface Keystore {
  ksPath: string
  ksKeyAlias: string
  ksPass: string
  ksKeyPass: string
  ksKeyalg: string
  ksValidity: string | number
  ksKeysize: string | number
  ksDname: string
}

interface BundleFile {
  path: string
  isAab?: boolean | undefined
}

interface BundletoolOptions<F extends BundleFile> {
  bundletoolPath: string
  keystore: Keystore
  file: F
}

export default function<F extends BundleFile>(options: BundletoolOptions<F>) {
  return new Promise<typeof options.file>(function(resolve, reject) {
    var log = logger.createLogger('util:bundletool')
    var bundletoolFilePath = options.bundletoolPath
    var bundle = options.file
    var bundlePath = bundle.path
    var outputPath = bundlePath + '.apks'
    var keystore = options.keystore

    function checkIfJava() {
      return new Promise<string>(function(resolve, reject) {
        var check = cp.spawn('java', ['-version'])
        var stderrChunks: Buffer[] = []
        check.on('error', function(err) {
            reject(err)
        })
        check.stderr.on('data', function(data: Buffer) {
          stderrChunks = stderrChunks.concat(data)
        })
        check.stderr.on('end', function() {
          var data = Buffer.concat(stderrChunks).toString().split('\n')[0]!
          var regex = new RegExp('(openjdk|java) version')
          var javaVersion = regex.test(data) ? data.split(' ')[2]!.replace(/"/g, '') : false
          if (javaVersion !== false) {
            resolve(javaVersion)
          }
          else {
            reject(new Error('Java not found'))
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
              return
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
                    return
                  }
                  readStream.on('end', function() {
                    zipfile.readEntry()
                  })
                  var writeStream = fs.createWriteStream(path.join('/tmp/', entry.fileName))
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
              fs.copyFileSync('/tmp/universal.apk', bundlePath)
              fs.unlinkSync('/tmp/universal.apk')
              fs.unlinkSync('/tmp/toc.pb')
              fs.unlinkSync(outputPath)
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
          ] as string[])
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
