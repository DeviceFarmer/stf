//
// Query the STF devices table through STF's own db layer.
//
// usage:
//   node stf-devices.mts list
//   node stf-devices.mts wait-ready [serial] [timeoutSeconds]
//   node stf-devices.mts wait-count <n> [timeoutSeconds]
//   node stf-devices.mts subscriber <serial>
//
// Exits 0 when the condition holds, 1 otherwise. Used by the integration and
// Android jobs so "is the device usable" is answered by STF's own state rather
// than by scraping the UI.
//

import r from 'rethinkdb'
import db from '../../lib/db/index.js'

interface Device {
  serial: string
  present?: boolean
  ready?: boolean
  status?: number
  owner?: unknown
  provider?: {name?: string}
  platform?: string
  sdk?: string
  version?: string
  abi?: string
  display?: {width: number, height: number}
  phone?: Record<string, unknown>
}

type Summary = ReturnType<typeof summarize>

function loadDevices() {
  return db.run(r.table('devices'))
    .then(function(cursor) {
      return (cursor.toArray ? cursor.toArray() : cursor) as Device[] | Promise<Device[]>
    })
}

function summarize(device: Device) {
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
  , display: device.display ?
      {width: device.display.width, height: device.display.height} :
      null
  , usable: !!(device.present && device.ready)
  , phone: device.phone || null
  }
}

var SUBSCRIBER_PROPERTIES = ['imei', 'imsi', 'phoneNumber', 'iccid']

function poll(predicate: (summaries: Summary[]) => boolean, timeoutSeconds: number) {
  var deadline = Date.now() + (timeoutSeconds || 240) * 1000

  function attempt(): Promise<boolean> {
    return loadDevices()
      .then(function(devices): boolean | Promise<boolean> {
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

function finish(ok: boolean) {
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
    var serial = process.argv[3] && process.argv[3] !== '-' ?
      process.argv[3] :
      null
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

  if (command === 'subscriber') {
    var subscriberSerial = process.argv[3]

    return loadDevices()
      .then(function(devices) {
        var device = devices.filter(function(candidate) {
          return !subscriberSerial || candidate.serial === subscriberSerial
        })[0]

        if (!device) {
          console.error('no device %s in the devices table', subscriberSerial || '')
          return finish(false)
        }

        var phone = device.phone || {}
        var missing = SUBSCRIBER_PROPERTIES.filter(function(name) {
          return !phone[name]
        })

        console.log(JSON.stringify(phone, null, 2))

        if (missing.length) {
          console.error('missing: %s', missing.join(', '))
        }
        return finish(!missing.length)
      })
      .catch(function(err) {
        console.error(err.stack || err.message)
        return finish(false)
      })
  }

  console.error('unknown command: %s', command)
  return process.exit(2)
}

main()
