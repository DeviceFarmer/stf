//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

/* global BigInt */
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */

(BigInt.prototype as BigInt & {toJSON: () => number}).toJSON = function() {
  return Number(this)
}

import * as uuid from 'uuid'

import wire from './index.js'
import type {DeviceStatusValues, RequirementTypeValues} from '../types/wire.js'

interface WireMessage {
  $code: number
  encode(): Buffer
}

interface DeviceRequirementSpec {
  value: string
  match: string
}

interface Reply {
  okay(data?: string | null, body?: unknown): Buffer
  fail(data?: string, body?: unknown): Buffer
  progress(data?: string, progress?: number): Buffer
}

var adbDeviceStatuses: Record<string, keyof DeviceStatusValues> = {
  device: 'ONLINE'
, emulator: 'ONLINE'
, unauthorized: 'UNAUTHORIZED'
, offline: 'OFFLINE'
, connecting: 'CONNECTING'
, authorizing: 'AUTHORIZING'
}

var wireutil = {
  global: '*ALL'
, makePrivateChannel: function() {
    return uuid.v4(null as unknown as undefined, Buffer.alloc(16)).toString('base64')
  }
, isKnownAdbState: function(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(adbDeviceStatuses, type)
  }
, toDeviceStatus: function(type: string): number {
    // adb has more states than STF handles (recovery, sideload, bootloader,
    // rescue, host, "no permissions (...)", ...). They all map to OFFLINE, so a
    // device in such a state can still be introduced to the system. Adding a
    // new DeviceStatus value instead would make older units fail to decode
    // the message, since protobufjs drops unknown values of a required enum.
    return wire.DeviceStatus[wireutil.isKnownAdbState(type) ?
      adbDeviceStatuses[type]! :
      'OFFLINE']
  }
, toDeviceRequirements: function(requirements: Record<string, DeviceRequirementSpec>) {
    return Object.keys(requirements).map(function(name) {
      var item = requirements[name]!
      return new wire.DeviceRequirement(
        name
      , item.value
      , wire.RequirementType[item.match.toUpperCase() as keyof RequirementTypeValues]
      )
    })
  }
, envelope: function(message: WireMessage) {
    return new wire.Envelope(message.$code, message.encode()).encodeNB()
  }
, transaction: function(channel: string, message: WireMessage) {
    return new wire.Envelope(
        message.$code
      , message.encode()
      , channel
      )
      .encodeNB()
  }
, reply: function(source: string): Reply {
    var seq = 0
    return {
      okay: function(data?: string | null, body?: unknown) {
        return wireutil.envelope(new wire.TransactionDoneMessage(
          source
        , seq++
        , true
        , data === null ? null : (data || 'success')
        , body ? JSON.stringify(body) : null
        ))
      }
    , fail: function(data?: string, body?: unknown) {
        return wireutil.envelope(new wire.TransactionDoneMessage(
          source
        , seq++
        , false
        , data || 'fail'
        , body ? JSON.stringify(body) : null
        ))
      }
    , progress: function(data?: string, progress?: number) {
        return wireutil.envelope(new wire.TransactionProgressMessage(
          source
        , seq++
        , data
        , ~~(progress as number)
        ))
      }
    }
  }
}

namespace wireutil {
  export type Message = WireMessage
  export type TransactionReply = Reply
  export type RequirementSpec = DeviceRequirementSpec
}

export default wireutil
