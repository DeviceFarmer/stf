import syrup from '@devicefarmer/stf-syrup'

import browsers from '@devicefarmer/stf-browser-db'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {DeviceBrowserAppMessageFields} from '../../../types/wire.js'
import type {BrowserApp, BrowserPackageEventFields} from '../../../types/stfservice-wire.js'
import type {
  Adb
, DevicePluginOptions
, Router
, ServicePlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import adbSyrup from '../support/adb.js'
import serviceSyrup from './service.js'

var mapping = (function() {
  var list: Record<string, string> = Object.create(null)
  Object.keys(browsers).forEach(function(id) {
    var browser = browsers[id]!
    if (browser.platforms.android) {
      list[browser.platforms.android.package] = id
    }
  })
  return list
})()

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(adbSyrup)
  .dependency(serviceSyrup)
  .define(function(
    options: DevicePluginOptions
  , router: Router
  , push: ZmqSocket
  , adb: Adb
  , service: ServicePlugin
  ) {
    var log = logger.createLogger('device:plugins:browser')

    function pkg(component: string) {
      return component.split('/', 1)[0]!
    }

    function appReducer(acc: DeviceBrowserAppMessageFields[], app: BrowserApp) {
      var packageName = pkg(app.component)
      var browserId = mapping[packageName]

      if (!browserId) {
        log.warn('Unmapped browser "%s"', packageName)
        return acc
      }

      acc.push({
        id: app.component
      , type: browserId
      , name: browsers[browserId]!.name
      , selected: app.selected
      , system: app.system
      })

      return acc
    }

    function compareIgnoreCase(a: string | null, b: string | null) {
      var la = (a || '').toLowerCase()
      var lb = (b || '').toLowerCase()

      if (la === lb) {
        return 0
      }
      else if (la < lb) {
        return -1
      }
      else {
        return 1
      }
    }

    function updateBrowsers(data: BrowserPackageEventFields) {
      log.info('Updating browser list')
      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceBrowserMessage(
          options.serial
        , data.selected
        , data.apps.reduce(appReducer, []).sort(function(appA, appB) {
            return compareIgnoreCase(appA.name, appB.name)
          })
        ))
      ])
    }

    function loadBrowsers() {
      log.info('Loading browser list')
      return service.getBrowsers()
        .then(updateBrowsers)
    }

    function ensureHttpProtocol(url: string) {
      // Check for '://' because a protocol-less URL might include
      // a username:password combination.
      return (url.indexOf('://') === -1 ? 'http://' : '') + url
    }

    service.on('browserPackageChange', updateBrowsers)

    router.on(wire.BrowserOpenMessage, function(channel, message) {
      message.url = ensureHttpProtocol(message.url)

      if (message.browser) {
        log.info('Opening "%s" in "%s"', message.url, message.browser)
      }
      else {
        log.info('Opening "%s"', message.url)
      }

      var reply = wireutil.reply(options.serial)
      adb.startActivity(options.serial, {
          action: 'android.intent.action.VIEW'
        , component: message.browser as string
        , data: message.url
        })
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          if (message.browser) {
            log.error(
              'Failed to open "%s" in "%s"'
            , message.url
            , message.browser
            , err.stack
            )
          }
          else {
            log.error('Failed to open "%s"', message.url, err.stack)
          }
          push.send([
            channel
          , reply.fail()
          ])
        })
    })

    router.on(wire.BrowserClearMessage, function(channel, message) {
      log.info('Clearing "%s"', message.browser)
      var reply = wireutil.reply(options.serial)
      adb.clear(options.serial, pkg(message.browser!))
        .then(function() {
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err) {
          log.error('Failed to clear "%s"', message.browser, err.stack)
          push.send([
            channel
          , reply.fail()
          ])
        })
    })

    return loadBrowsers()
  })
