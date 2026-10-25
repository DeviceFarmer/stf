/**
* Copyright © 2019-2025 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import util from 'util'

import * as uuid from 'uuid'
import deviceData from '@devicefarmer/stf-device-db'

import dbapi from '../db/api.js'
import wire from '../wire/index.js'

import timeutil from './timeutil.js'

var generate = function(wantedModel?: string) {
  // no base64 because some characters as '=' or '/' are not compatible through API (delete devices)
  const serial = 'fake-' + util.format('%s', uuid.v4()).replace(/-/g, '')

  return dbapi.saveDeviceInitialState(serial, {
      provider: {
        name: 'FAKE/1'
      , channel: '*fake'
      }
    , status: wire.DeviceStatus.OFFLINE
    , statusTimeStamp: timeutil.now('nano')
    })
    .then(function() {
      const sampled: deviceData.DeviceRecord | null = wantedModel ?
        deviceData.find({model: wantedModel, name: wantedModel}) :
        deviceData.sample()
      const model = wantedModel || (sampled as deviceData.DeviceSample).model
      const manufacturer = (sampled && sampled.brand) || 'Foo Electronics'
      const marketName = (sampled && sampled.marketName) || model
      return dbapi.saveDeviceIdentity(serial, {
        platform: 'Android'
      , manufacturer: manufacturer
      , operator: 'Loss Networks'
      , model: model
      , version: '4.1.2'
      , abi: 'armeabi-v7a'
      , sdk: (8 + Math.floor(Math.random() * 12)).toString() // string required!
      , display: {
          density: 3
        , fps: 60
        , height: 1920
        , id: 0
        , rotation: 0
        , secure: true
        , url: '/404.jpg'
        , width: 1080
        , xdpi: 442
        , ydpi: 439
        }
      , phone: {
          iccid: '1234567890123456789'
        , imei: '123456789012345'
        , imsi: '123456789012345'
        , network: 'LTE'
        , phoneNumber: '0000000000'
        }
      , product: model
      , cpuPlatform: 'msm8996'
      , openGLESVersion: '3.1'
      , marketName: marketName
      , cpu: sampled ? sampled.cpu : null
      , memory: sampled ? sampled.memory : null
      , releasedAt: sampled ? sampled.date : null
      })
    })
    .then(function() {
      return dbapi.setDeviceAbsent(serial)
    })
    .return(serial)
}

export default {generate}
