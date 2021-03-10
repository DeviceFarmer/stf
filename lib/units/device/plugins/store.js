var syrup = require('@devicefarmer/stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var DeviceClient = require('@devicefarmer/adbkit/dist/src/adb/DeviceClient').default

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/adb'))
  .define(function(options, router, push, adb) {
    var deviceClient = new DeviceClient(adb, options.serial)
    var log = logger.createLogger('device:plugins:store')

    router.on(wire.StoreOpenMessage, function(channel) {
      log.info('Opening Play Store')

      var reply = wireutil.reply(options.serial)
      deviceClient.startActivity({
          action: 'android.intent.action.MAIN'
        , component: 'com.android.vending/.AssetBrowserActivity'
          // FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
          // FLAG_ACTIVITY_BROUGHT_TO_FRONT
          // FLAG_ACTIVITY_NEW_TASK
        , flags: 0x10600000
        })
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Play Store could not be opened', err.stack)
          push.send([
            channel
          , reply.fail()
          ])
        })
    })
  })
