import {createRequire} from 'module'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../util/logger.js'
import lifecycle from '../../util/lifecycle.js'
import type {DeviceOptions} from '../../types/device.js'

var require = createRequire(import.meta.url)

interface SoloPlugin {
  poke(): void
}

export default function(options: DeviceOptions) {
  // Show serial number in logs
  logger.setGlobalIdentifier(options.serial)

  var log = logger.createLogger('device')

  return syrup.serial()
    // We want to send logs before anything else starts happening
    .dependency(require('./plugins/logger.js').default)
    .define(function(options: DeviceOptions) {
      var log = logger.createLogger('device')
      log.info('Preparing device')
      return syrup.serial()
        .dependency(require('./plugins/heartbeat.js').default)
        .dependency(require('./plugins/solo.js').default)
        .dependency(require('./plugins/screen/stream.js').default)
        .dependency(require('./plugins/screen/capture.js').default)
        .dependency(require('./plugins/vnc/index.js').default)
        .dependency(require('./plugins/service.js').default)
        .dependency(require('./plugins/browser.js').default)
        .dependency(require('./plugins/store.js').default)
        .dependency(require('./plugins/clipboard.js').default)
        .dependency(require('./plugins/logcat.js').default)
        .dependency(require('./plugins/mute.js').default)
        .dependency(require('./plugins/shell.js').default)
        .dependency(require('./plugins/touch/index.js').default)
        .dependency(require('./plugins/install.js').default)
        .dependency(require('./plugins/forward/index.js').default)
        .dependency(require('./plugins/group.js').default)
        .dependency(require('./plugins/cleanup.js').default)
        .dependency(require('./plugins/reboot.js').default)
        .dependency(require('./plugins/connect.js').default)
        .dependency(require('./plugins/account.js').default)
        .dependency(require('./plugins/ringer.js').default)
        .dependency(require('./plugins/wifi.js').default)
        .dependency(require('./plugins/bluetooth.js').default)
        .dependency(require('./plugins/sd.js').default)
        .dependency(require('./plugins/filesystem.js').default)
        .define(function(options: DeviceOptions, heartbeat: unknown, solo: SoloPlugin) {
          if (process.send) {
            // Only if we have a parent process
            process.send('ready')
          }
          log.info('Fully operational')
          return solo.poke()
        })
        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      log.fatal('Setup had an error', err.stack)
      lifecycle.fatal()
    })
}
