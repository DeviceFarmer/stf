//
// Query the STF devices table through STF's own db layer.
//
// usage:
//   node stf-devices.js list
//   node stf-devices.js wait-ready [serial] [timeoutSeconds]
//   node stf-devices.js wait-count <n> [timeoutSeconds]
//
// Exits 0 when the condition holds, 1 otherwise. Used by the integration and
// Android jobs so "is the device usable" is answered by STF's own state rather
// than by scraping the UI.
//

var r = require('rethinkdb')
var db = require('../../lib/db')

function loadDevices() {
  return db.run(r.table('devices'))
    .then(function(cursor) {
      return cursor.toArray ? cursor.toArray() : cursor
    })
}

function summarize(device) {
  return {
    serial: device.serial
  , present: !!device.present
  , ready: !!device.ready
  , status: device.status
  , using: !!device.owner
  , provider: device.provider && device.provider.name
  , platform: device.platform
  , sdk: device.sdk
  , version: device.version
  , abi: device.abi
  , display: device.display
      ? {width: device.display.width, height: device.display.height}
      : null
  , usable: !!(device.present && device.ready)
  }
}

function poll(predicate, timeoutSeconds) {
  var deadline = Date.now() + (timeoutSeconds || 240) * 1000

  function attempt() {
    return loadDevices()
      .then(function(devices) {
        var summaries = devices.map(summarize)
        var verdict = predicate(summaries)

        if (verdict) {
          console.log(JSON.stringify(summaries, null, 2))
          return true
        }
        if (Date.now() > deadline) {
          console.error('timed out waiting; last seen:')
          console.error(JSON.stringify(summaries, null, 2))
          return false
        }
        process.stderr.write('.')
        return new Promise(function(resolve) {
          setTimeout(resolve, 3000)
        }).then(attempt)
      })
      .catch(function(err) {
        if (Date.now() > deadline) {
          console.error('giving up: %s', err.message)
          return false
        }
        process.stderr.write('x')
        return new Promise(function(resolve) {
          setTimeout(resolve, 3000)
        }).then(attempt)
      })
  }

  return attempt()
}

function finish(ok) {
  // The db keeps a live connection open, so exit rather than waiting for the
  // event loop to drain.
  process.exitCode = ok ? 0 : 1
  db.close()
  setTimeout(function() {
    process.exit(ok ? 0 : 1)
  }, 500)
}

function main() {
  var command = process.argv[2] || 'list'

  if (command === 'list') {
    return loadDevices()
      .then(function(devices) {
        console.log(JSON.stringify(devices.map(summarize), null, 2))
        finish(true)
      })
      .catch(function(err) {
        console.error(err.stack || err.message)
        finish(false)
      })
  }

  if (command === 'wait-ready') {
    var serial = process.argv[3] && process.argv[3] !== '-'
      ? process.argv[3]
      : null
    var timeout = Number(process.argv[4] || 240)

    return poll(function(devices) {
      return devices.some(function(device) {
        return device.usable && (!serial || device.serial === serial)
      })
    }, timeout).then(finish)
  }

  if (command === 'wait-count') {
    var wanted = Number(process.argv[3] || 1)
    var countTimeout = Number(process.argv[4] || 240)

    return poll(function(devices) {
      return devices.length >= wanted
    }, countTimeout).then(finish)
  }

  console.error('unknown command: %s', command)
  process.exit(2)
}

main()
