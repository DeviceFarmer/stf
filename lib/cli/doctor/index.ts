//
// Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {SpawnOptionsWithoutStdio} from 'child_process'
import type Bluebird from 'bluebird'

var require = createRequire(import.meta.url)

var command = 'doctor'

var describe = 'Diagnose potential issues with your installation.'

var builder = function(yargs: Argv) {
  return yargs
}

var handler = function() {
  var cp: typeof import('child_process') = require('child_process')
  var os: typeof import('os') = require('os')
  var util: typeof import('util') = require('util')

  var semver: typeof import('semver') = require('semver')
  var Promise: typeof import('bluebird') = require('bluebird')

  var pkg = require('../../../package')
  var log = require('../../util/logger.js').default.createLogger('cli:doctor')

  interface CheckErrorClass {
    new(...args: unknown[]): Error
  }

  interface Checker {
    call(command: string, args: string[], options?: SpawnOptionsWithoutStdio): Bluebird<string>
    extract(what: string, re: RegExp): (input: string) => Bluebird<string>
    version(wantedVersion: string): (currentVersion: string) => Bluebird<void>
  }

  function CheckError(this: Error) {
    Error.captureStackTrace(this, this.constructor)
    this.name = 'CheckError'
    this.message = util.format.apply(util, arguments as unknown as Parameters<typeof util.format>)
  }

  util.inherits(CheckError, Error)

  function call(command: string, args: string[], options?: SpawnOptionsWithoutStdio) {
    return new Promise<string>(function(resolve, reject) {
      var proc = cp.spawn(command, args, options)
      var stdout: Buffer[] = []

      proc.stdout.on('data', function(data) {
        stdout.push(data)
      })

      proc.on('error', reject)

      proc.on('close', function(code, signal) {
        if (signal) {
          reject(new (CheckError as unknown as CheckErrorClass)('Exited with signal %s', signal))
        }
        else if (code === 0) {
          resolve(Buffer.concat(stdout).toString())
        }
        else {
          reject(new (CheckError as unknown as CheckErrorClass)('Exited with status %s', code))
        }
      })
    })
  }

  function check(label: string, fn: (checker: Checker) => unknown) {
    class Check implements Checker {
      call(command: string, args: string[], options?: SpawnOptionsWithoutStdio) {
        return call(command, args, options).catch(function(err) {
          if (err.code === 'ENOENT') {
            throw new (CheckError as unknown as CheckErrorClass)(
              '%s is not installed (`%s` is missing)'
            , label
            , command
            )
          }

          throw err
        })
      }

      extract(what: string, re: RegExp) {
        return function(input: string) {
          return Promise.try(function() {
            var match = re.exec(input)
            if (!match) {
              throw new (CheckError as unknown as CheckErrorClass)(
                util.format('%s %s cannot be detected', label, what)
              )
            }
            return match[1]!
          })
        }
      }

      version(wantedVersion: string) {
        return function(currentVersion: string) {
          return Promise.try(function() {
            log.info('Using %s %s', label, currentVersion)
            var sanitizedVersion = currentVersion.replace(/~.*/, '')
            return semver.satisfies(sanitizedVersion, wantedVersion)
          })
          .then(function(satisfied) {
            if (!satisfied) {
              throw new (CheckError as unknown as CheckErrorClass)(
                '%s is currently %s but needs to be %s'
              , label
              , currentVersion
              , wantedVersion
              )
            }
          })
        }
      }
    }

    return Promise.try(function() {
        return fn(new Check())
      })
      .catch(CheckError as unknown as CheckErrorClass, function(err) {
        log.error(err.message)
      })
      .catch(function(err) {
        log.error('Unexpected error checking %s: %s', label, err)
      })
  }

  function checkOSArch() {
    log.info('OS Arch: %s', os.arch())
  }

  function checkOSPlatform() {
    log.info('OS Platform: %s', os.platform())
    if (os.platform() === 'win32') {
      log.warn('STF has never been tested on Windows. Contributions are welcome!')
    }
  }

  function checkOSRelease() {
    log.info('OS Platform: %s', os.release())
  }

  function checkNodeVersion() {
    log.info('Using Node %s', process.versions.node)
  }

  function checkLocalRethinkDBVersion() {
    return check('RethinkDB', function(checker) {
      return checker.call('rethinkdb', ['--version'])
        .then(checker.extract('version', /rethinkdb ([^\s]+)/))
        .then(checker.version(pkg.externalDependencies.rethinkdb))
    })
  }

  function checkGraphicsMagick() {
    return check('GraphicsMagick', function(checker) {
      return checker.call('gm', ['-version'])
        .then(checker.extract('version', /GraphicsMagick ([^\s]+)/))
        .then(checker.version(pkg.externalDependencies.gm))
    })
  }

  function checkZeroMQ() {
    return check('ZeroMQ', function(checker) {
      var zmq = require('zeromq')
      return checker.version(pkg.externalDependencies.zeromq)(zmq.version)
    })
  }

  function checkProtoBuf() {
    return check('ProtoBuf', function(checker) {
      return checker.call('protoc', ['--version'])
        .then(checker.extract('version', /libprotoc ([^\s]+)/))
        .then(checker.version(pkg.externalDependencies.protobuf))
    })
  }

  function checkADB() {
    return check('ADB', function(checker) {
      return checker.call('adb', ['version'])
        .then(checker.extract('version', /Android Debug Bridge version ([^\s]+)/))
        .then(checker.version(pkg.externalDependencies.adb))
    })
  }

  return Promise.all([
    checkOSArch()
  , checkOSPlatform()
  , checkOSRelease()
  , checkNodeVersion()
  , checkLocalRethinkDBVersion()
  , checkGraphicsMagick()
  , checkZeroMQ()
  , checkProtoBuf()
  , checkADB()
  ])
}

export {command, describe, builder, handler}
