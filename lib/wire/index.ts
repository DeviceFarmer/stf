import path from 'path'

import protobuf from './protobuf.js'
import type {Wire, MessageTypeValues} from '../types/wire.js'

var wire = protobuf.build(
  protobuf.load(path.join(import.meta.dirname, 'wire.proto'))
) as unknown as Wire

wire.ReverseMessageType = (Object.keys(wire.MessageType) as Array<keyof MessageTypeValues>)
  .reduce(
    function(acc: Wire['ReverseMessageType'], type) {
      var code = wire.MessageType[type]
      if (!wire[type]) {
        throw new Error('wire.MessageType has unknown value "' + type + '"')
      }
      wire[type].$code = wire[type].prototype.$code = code
      acc[code] = type
      return acc
    }
  , Object.create(null)
  )

export default wire
