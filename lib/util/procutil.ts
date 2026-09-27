import util from 'util'
import cp from 'child_process'

import Promise from 'bluebird'

import logger from './logger.js'

var log = logger.createLogger('util:procutil')

class ExitError extends Error {
  declare code: number

  constructor(code: number) {
    super()
    this.name = 'ExitError'
    this.code = code
    this.message = util.format('Exit code "%d"', code)
    Error.captureStackTrace(this, ExitError)
  }
}

interface ForkPromise extends Promise<number | null> {
  stop(): Promise<Promise.Inspection<number | null>>
}

// Export

// Export
var fork = function(filename: string, args: string[]) {
  log.info('Forking "%s %s"', filename, args.join(' '))

  var resolve_: (value: number | null) => void, reject_: (reason: unknown) => void
  var promise = new Promise<number | null>(function(resolve, reject) {
    resolve_ = resolve
    reject_ = reject
  })
  var proc = cp.fork.apply(cp, arguments as unknown as [string, string[]])

  function sigintListener() {
    proc.kill('SIGINT')
  }

  function sigtermListener() {
    proc.kill('SIGTERM')
  }

  process.on('SIGINT', sigintListener)
  process.on('SIGTERM', sigtermListener)

  proc.on('error', function(err) {
    reject_(err)
    proc.kill()
  })

  proc.on('exit', function(code, signal) {
    if (signal) {
      resolve_(code)
    }
    else if (code! > 0 && code !== 130 && code !== 143) {
      reject_(new ExitError(code!))
    }
    else {
      resolve_(code)
    }
  })

  var wrappedPromise = promise
    .finally(function() {
      process.removeListener('SIGINT', sigintListener)
      process.removeListener('SIGTERM', sigtermListener)
    }) as ForkPromise

  wrappedPromise.stop = function() {
    proc.kill()
    return wrappedPromise.reflect()
  }

  return wrappedPromise
}

// Export
var gracefullyKill = function(proc: cp.ChildProcess, timeout: number) {
  function killer(signal: NodeJS.Signals) {
    var resolve_: () => void
    var promise = new Promise<void>(function(resolve) {
      resolve_ = resolve
    })

    function onExit() {
      resolve_()
    }

    proc.once('exit', onExit)
    proc.kill(signal)

    return promise.finally(function() {
      proc.removeListener('exit', onExit)
    })
  }

  return killer('SIGTERM')
    .timeout(timeout)
    .catch(function() {
      return killer('SIGKILL')
        .timeout(timeout)
    })
}

export default {ExitError, fork, gracefullyKill}
