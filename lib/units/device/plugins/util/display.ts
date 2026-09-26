import util from 'util'

import syrup from '@devicefarmer/stf-syrup'
import EventEmitter from 'eventemitter3'

import logger from '../../../../util/logger.js'
import streamutil from '../../../../util/streamutil.js'
import type Bluebird from 'bluebird'
import type {
  Adb
, DisplayEvents
, DisplayProperties
, DevicePluginOptions
, MinicapResource
, ScreenOptions
, ServicePlugin
} from '../../../../types/device-plugins.js'
import adbSyrup from '../../support/adb.js'
import minicapSyrup from '../../resources/minicap.js'
import serviceSyrup from '../service.js'
import optionsSyrup from '../screen/options.js'

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(minicapSyrup)
  .dependency(serviceSyrup)
  .dependency(optionsSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , minicap: MinicapResource
  , service: ServicePlugin
  , screenOptions: ScreenOptions
  ) {
    var log = logger.createLogger('device:plugins:display')

    class Display extends EventEmitter.EventEmitter<DisplayEvents> {
      declare id: number
      declare properties: DisplayProperties

      constructor(id: number, properties: DisplayProperties) {
        super()
        this.id = id
        this.properties = properties
      }

      updateRotation(newRotation: number) {
        log.info('Rotation changed to %d', newRotation)
        this.properties.rotation = newRotation
        this.emit('rotationChange', newRotation)
      }
    }

    function infoFromMinicap(id: number): Bluebird<DisplayProperties> {
      return minicap.run(options.screenGrabber, util.format('-d %d -i', id))
        .then(streamutil.readAll)
        .then(function(out) {
          var match
          if ((match = /^ERROR: (.*)$/.exec(out as unknown as string))) {
            throw new Error(match[1])
          }

          try {
            return JSON.parse(out as unknown as string)
          }
          catch (e) {
            throw new Error(out.toString())
          }
        })
    }

    function infoFromService(id: number) {
      return service.getDisplay(id)
    }

    function readInfo(id: number) {
      log.info('Reading display info')
      return infoFromService(id)
        .catch(function() {
          return infoFromMinicap(id)
        })
        .then(function(properties) {
          properties.url = screenOptions.publicUrl
          return new Display(id, properties)
        })
    }

    return readInfo(0).then(function(display) {
      service.on('rotationChange', function(data) {
        display.updateRotation(data.rotation)
      })

      return display
    })
  })
