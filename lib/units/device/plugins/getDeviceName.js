var syrup = require('@devicefarmer/stf-syrup')
let adbkit = require('@devicefarmer/adbkit')
var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var streamutil = require('../../../util/streamutil')

module.exports = syrup.serial()
  .dependency(require('../support/adb'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, adb, router, push) {
    let log = logger.createLogger('device:plugins:deviceName')

    router.on(wire.DeviceNameMessage, function(channel) {
      log.info('EYAL YOU UNDERSTOOD')
      const reply = wireutil.reply(options.serial)

      adb.shell(options.serial, ['dumpsys', 'bluetooth_manager'])
        .then(adbkit.util.readAll).then(function(output) {
        const deviceOutput = output.toString('utf-8')
        const deviceName = deviceOutput.split('Name: ')[1].split('\n')[0];
          })
        .then(function() {
        push.send([
          channel
          , reply.okay()
        ])
      })
    })
  })
