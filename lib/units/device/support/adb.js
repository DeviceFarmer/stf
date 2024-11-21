/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var syrup = require('@devicefarmer/stf-syrup')
var logger = require('../../../util/logger')
var promiseutil = require('../../../util/promiseutil')

module.exports = syrup.serial()
  .define(function(options) {
    var log = logger.createLogger('device:support:adb')
    var adb = require('../../../util/adbutil')(options)

    function ensureBootComplete() {
      return promiseutil.periodicNotify(
          adb.waitBootComplete(options.serial)
        , 1000
        )
        .progressed(function() {
          log.info('Waiting for boot to complete')
        })
        .timeout(options.bootCompleteTimeout)
    }

    return ensureBootComplete()
      .return(adb)
  })
