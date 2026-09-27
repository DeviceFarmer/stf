import syrup from '@devicefarmer/stf-syrup'
import _ from 'lodash'
import tr from 'transliteration'
import type {
  DeviceData
, DeviceIdentity
, DevicePluginOptions
, UrlFormat
} from '../../../../types/device-plugins.js'
import identitySyrup from './identity.js'
import dataSyrup from './data.js'

export default syrup.serial()
  .dependency(identitySyrup)
  .dependency(dataSyrup)
  .define(function(
    options: DevicePluginOptions
  , identity: DeviceIdentity
  , data: DeviceData | null
  ): UrlFormat {
    function createSlug() {
      var model = identity.model
      var name = data ? data.name.id : ''

      return (name === '' || model.toLowerCase() === name.toLowerCase()) ?
        tr.slugify(model) :
        tr.slugify(name + ' ' + model)
    }

    var defaults = {
      publicIp: options.publicIp
    , serial: options.serial
    , model: identity.model
    , name: data ? data.name.id : ''
    , slug: createSlug()
    }

    return function(template, port) {
      return _.template(template, {
          imports: {
            slugify: tr.slugify
          }
        })(_.defaults({publicPort: port}, defaults))
    }
  })
