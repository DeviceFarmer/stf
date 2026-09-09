var chai = require('chai')
var expect = chai.expect

var wire = require('../../lib/wire')
var wireutil = require('../../lib/wire/util')
var wirerouter = require('../../lib/wire/router')
var protobuf = require('../../lib/wire/protobuf')
var pathutil = require('../../lib/util/pathutil')

var pbjs5MessageType = {
  CopyMessage: 33
, DeviceIntroductionMessage: 74
, DeviceAbsentMessage: 1
, DeviceIdentityMessage: 2
, DeviceLogcatEntryMessage: 3
, DeviceLogMessage: 4
, DeviceReadyMessage: 5
, DevicePresentMessage: 6
, DevicePropertiesMessage: 7
, DeviceRegisteredMessage: 8
, DeviceStatusMessage: 9
, GroupMessage: 10
, InstallMessage: 30
, PhysicalIdentifyMessage: 29
, JoinGroupMessage: 11
, JoinGroupByAdbFingerprintMessage: 69
, JoinGroupByVncAuthResponseMessage: 90
, VncAuthResponsesUpdatedMessage: 91
, AutoGroupMessage: 70
, AdbKeysUpdatedMessage: 71
, KeyDownMessage: 12
, KeyPressMessage: 13
, KeyUpMessage: 14
, LaunchActivityMessage: 31
, LeaveGroupMessage: 15
, LogcatApplyFiltersMessage: 16
, PasteMessage: 32
, ProbeMessage: 17
, ShellCommandMessage: 18
, ShellKeepAliveMessage: 19
, TouchDownMessage: 21
, TouchMoveMessage: 22
, TouchUpMessage: 23
, TouchCommitMessage: 65
, TouchResetMessage: 66
, GestureStartMessage: 67
, GestureStopMessage: 68
, TransactionDoneMessage: 24
, TransactionProgressMessage: 25
, TypeMessage: 26
, UngroupMessage: 27
, UninstallMessage: 34
, RotateMessage: 35
, ForwardTestMessage: 36
, ForwardCreateMessage: 37
, ForwardRemoveMessage: 38
, LogcatStartMessage: 39
, LogcatStopMessage: 40
, BrowserOpenMessage: 41
, BrowserClearMessage: 42
, AirplaneModeEvent: 43
, BatteryEvent: 44
, DeviceBrowserMessage: 45
, ConnectivityEvent: 46
, PhoneStateEvent: 47
, RotationEvent: 48
, StoreOpenMessage: 49
, ScreenCaptureMessage: 50
, DeviceHeartbeatMessage: 73
, RebootMessage: 52
, ConnectStartMessage: 53
, ConnectStopMessage: 54
, RingerSetMessage: 56
, RingerGetMessage: 64
, WifiSetEnabledMessage: 57
, WifiGetStatusMessage: 58
, AccountAddMenuMessage: 59
, AccountAddMessage: 60
, AccountCheckMessage: 63
, AccountGetMessage: 62
, AccountRemoveMessage: 55
, SdStatusMessage: 61
, ReverseForwardsEvent: 72
, FileSystemListMessage: 81
, FileSystemGetMessage: 82
, ConnectStartedMessage: 92
, ConnectStoppedMessage: 93
, BluetoothSetEnabledMessage: 94
, BluetoothGetStatusMessage: 95
, BluetoothCleanBondedMessage: 96
, GroupUserChangeMessage: 1200
, DeviceGroupChangeMessage: 1201
, DeviceOriginGroupMessage: 1202
, DeleteUserMessage: 1203
, UpdateAccessTokenMessage: 1204
, GroupChangeMessage: 1205
, UserChangeMessage: 1206
, DeviceChangeMessage: 1207
}

var pbjs5Encodings = [
  {
    what: 'Envelope wrapping KeyDownMessage'
  , hex: '080c12030a0161'
  , encode: function() {
      return wireutil.envelope(new wire.KeyDownMessage('a'))
    }
  }
, {
    what: 'Envelope wrapping TypeMessage with a reply channel'
  , hex: '081a12070a0568656c6c6f1a046368616e'
  , encode: function() {
      return wireutil.transaction('chan', new wire.TypeMessage('hello'))
    }
  }
, {
    what: 'a fieldless message'
  , hex: ''
  , encode: function() {
      return new wire.ProbeMessage().encodeNB()
    }
  }
, {
    what: 'Envelope wrapping a fieldless message'
  , hex: '08111200'
  , encode: function() {
      return wireutil.envelope(new wire.ProbeMessage())
    }
  }
, {
    what: 'TransactionDoneMessage with null optionals'
  , hex: '0a06736f7572636510001801'
  , encode: function() {
      return new wire.TransactionDoneMessage('source', 0, true, null, null).encodeNB()
    }
  }
, {
    what: 'TransactionDoneMessage with every field set'
  , hex: '0a06736f757263651007180022046661696c2a077b2261223a317d'
  , encode: function() {
      return new wire.TransactionDoneMessage(
        'source', 7, false, 'fail', '{"a":1}'
      ).encodeNB()
    }
  }
, {
    what: 'TransactionProgressMessage'
  , hex: '0a06736f7572636510031a07776f726b696e67202a'
  , encode: function() {
      return new wire.TransactionProgressMessage('source', 3, 'working', 42).encodeNB()
    }
  }
, {
    what: 'TransactionProgressMessage with a zero progress'
  , hex: '0a06736f7572636510031a07776f726b696e672000'
  , encode: function() {
      return new wire.TransactionProgressMessage('source', 3, 'working', 0).encodeNB()
    }
  }
, {
    what: 'a reply with no data'
  , hex: '0818120c0a06736f7572636510001801'
  , encode: function() {
      return wireutil.reply('source').okay(null)
    }
  }
, {
    what: 'a reply with the default data'
  , hex: '081812150a06736f7572636510001801220773756363657373'
  , encode: function() {
      return wireutil.reply('source').okay()
    }
  }
, {
    what: 'a reply with a JSON body'
  , hex: '0818121b0a06736f75726365100018012204646f6e652a077b2261223a317d'
  , encode: function() {
      return wireutil.reply('source').okay('done', {a: 1})
    }
  }
, {
    what: 'a failing reply'
  , hex: '081812120a06736f757263651000180022046661696c'
  , encode: function() {
      return wireutil.reply('source').fail()
    }
  }
, {
    what: 'a progress reply'
  , hex: '081912150a06736f7572636510001a07776f726b696e67202a'
  , encode: function() {
      return wireutil.reply('source').progress('working', 42.7)
    }
  }
, {
    what: 'DeviceStatusMessage'
  , hex: '0a0673657269616c10031900b04cb01ff77142'
  , encode: function() {
      return new wire.DeviceStatusMessage(
        'serial', wire.DeviceStatus.ONLINE, 1234567890123
      ).encodeNB()
    }
  }
, {
    what: 'DeviceIntroductionMessage with a nested group'
  , hex: '0a0673657269616c10021a0f0a076368616e6e656c12046e616d652100b04cb01f' +
      'f771422a420a02696412046e616d651a0e0a056140622e6312054f776e6572221209' +
      '000000000000f03f1100000000000000402a087374616e6461726430053a066f7269' +
      '67696e'
  , encode: function() {
      return new wire.DeviceIntroductionMessage(
        'serial'
      , wire.DeviceStatus.UNAUTHORIZED
      , new wire.ProviderMessage('channel', 'name')
      , 1234567890123
      , new wire.DeviceGroupMessage(
          'id'
        , 'name'
        , new wire.DeviceGroupOwnerMessage('a@b.c', 'Owner')
        , new wire.DeviceGroupLifetimeMessage(1, 2)
        , 'standard'
        , 5
        , 'origin'
        )
      ).encodeNB()
    }
  }
, {
    what: 'TouchDownMessage with floats'
  , hex: '080110021d80d6fc3d25e4d67c3f2d0000003f'
  , encode: function() {
      return new wire.TouchDownMessage(1, 2, 0.123456, 0.987654, 0.5).encodeNB()
    }
  }
, {
    what: 'TouchDownMessage without the optional pressure'
  , hex: '080110021d80d6fc3d25e4d67c3f'
  , encode: function() {
      return new wire.TouchDownMessage(1, 2, 0.123456, 0.987654).encodeNB()
    }
  }
, {
    what: 'TouchUpMessage'
  , hex: '08091001'
  , encode: function() {
      return new wire.TouchUpMessage(9, 1).encodeNB()
    }
  }
, {
    what: 'RingerSetMessage built from the SILENT enum name'
  , hex: '0800'
  , encode: function() {
      return new wire.RingerSetMessage('SILENT').encodeNB()
    }
  }
, {
    what: 'RingerSetMessage built from the VIBRATE enum name'
  , hex: '0801'
  , encode: function() {
      return new wire.RingerSetMessage('VIBRATE').encodeNB()
    }
  }
, {
    what: 'RingerSetMessage built from the NORMAL enum name'
  , hex: '0802'
  , encode: function() {
      return new wire.RingerSetMessage('NORMAL').encodeNB()
    }
  }
, {
    what: 'RingerSetMessage built from a numeric enum value'
  , hex: '0802'
  , encode: function() {
      return new wire.RingerSetMessage(wire.RingerMode.NORMAL).encodeNB()
    }
  }
, {
    what: 'GroupMessage with repeated nested requirements'
  , hex: '0a150a056140622e6312054f776e65721a0567726f75701084071a0f0a06736572' +
      '69616c120361626318031a100a0776657273696f6e12033e3d3518011a0f0a056d6f' +
      '64656c12044e65782a180222057573616765'
  , encode: function() {
      return new wire.GroupMessage(
        new wire.OwnerMessage('a@b.c', 'Owner', 'group')
      , 900
      , [
          new wire.DeviceRequirement('serial', 'abc', wire.RequirementType.EXACT)
        , new wire.DeviceRequirement('version', '>=5', wire.RequirementType.SEMVER)
        , new wire.DeviceRequirement('model', 'Nex*', wire.RequirementType.GLOB)
        ]
      , 'usage'
      ).encodeNB()
    }
  }
, {
    what: 'DevicePropertiesMessage'
  , hex: '0a0673657269616c12060a016112013112060a0162120132'
  , encode: function() {
      return new wire.DevicePropertiesMessage('serial', [
        new wire.DeviceProperty('a', '1')
      , new wire.DeviceProperty('b', '2')
      ]).encodeNB()
    }
  }
, {
    what: 'LogcatStartMessage with no filters'
  , hex: ''
  , encode: function() {
      return new wire.LogcatStartMessage([]).encodeNB()
    }
  }
, {
    what: 'LogcatStartMessage with one filter'
  , hex: '0a070a037461671004'
  , encode: function() {
      return new wire.LogcatStartMessage([
        new wire.LogcatFilter('tag', 4)
      ]).encodeNB()
    }
  }
, {
    what: 'BatteryEvent'
  , hex: '0a0673657269616c12067374617475731a066865616c74682206736f7572636528' +
      '323064390000000000803940419a99999999990d40'
  , encode: function() {
      return new wire.BatteryEvent(
        'serial', 'status', 'health', 'source', 50, 100, 25.5, 3.7
      ).encodeNB()
    }
  }
, {
    what: 'AirplaneModeEvent'
  , hex: '0a0673657269616c1001'
  , encode: function() {
      return new wire.AirplaneModeEvent('serial', true).encodeNB()
    }
  }
, {
    what: 'ConnectivityEvent with only some optionals'
  , hex: '0a0673657269616c10011a0477696669'
  , encode: function() {
      return new wire.ConnectivityEvent('serial', true, 'wifi').encodeNB()
    }
  }
, {
    what: 'PhoneStateEvent'
  , hex: '0a0673657269616c120a696e5f73657276696365180022086f70657261746f72'
  , encode: function() {
      return new wire.PhoneStateEvent('serial', 'in_service', false, 'operator').encodeNB()
    }
  }
, {
    what: 'RotationEvent'
  , hex: '0a0673657269616c108e02'
  , encode: function() {
      return new wire.RotationEvent('serial', 270).encodeNB()
    }
  }
, {
    what: 'DeviceLogMessage'
  , hex: '0a0673657269616c110000a0b48065d2411804220374616728e70732076d657373' +
      '6167653a0a6964656e746966696572'
  , encode: function() {
      return new wire.DeviceLogMessage(
        'serial', 1234567890.5, 4, 'tag', 999, 'message', 'identifier'
      ).encodeNB()
    }
  }
, {
    what: 'GroupChangeMessage with repeated scalars and nested fields'
  , hex: '0a560a02696412046e616d651a087374616e646172642204757365722a0e0a0561' +
      '40622e6312054f776e6572320d0a057374617274120473746f7038840740014a0673' +
      '657269616c52056140622e635a05726561647960011206616374696f6e1a05614062' +
      '2e632000280030013a056140622e6340004a0673657269616c5100b04cb01ff77142'
  , encode: function() {
      return new wire.GroupChangeMessage(
        new wire.GroupField(
          'id'
        , 'name'
        , 'standard'
        , 'user'
        , new wire.GroupOwnerField('a@b.c', 'Owner')
        , [new wire.GroupDateField('start', 'stop')]
        , 900
        , 1
        , ['serial']
        , ['a@b.c']
        , 'ready'
        , true
        )
      , 'action'
      , ['a@b.c']
      , false
      , false
      , true
      , ['a@b.c']
      , false
      , ['serial']
      , 1234567890123
      ).encodeNB()
    }
  }
]

var pbjs5Decodings = [
  {
    what: 'TransactionDoneMessage with null optionals'
  , type: 'TransactionDoneMessage'
  , hex: '0a06736f7572636510001801'
  , values: {source: 'source', seq: 0, success: true, data: null, body: null}
  }
, {
    what: 'TransactionProgressMessage with a zero progress'
  , type: 'TransactionProgressMessage'
  , hex: '0a06736f7572636510031a07776f726b696e672000'
  , values: {source: 'source', seq: 3, data: 'working', progress: 0}
  }
, {
    what: 'DeviceIntroductionMessage with a nested group'
  , type: 'DeviceIntroductionMessage'
  , hex: '0a0673657269616c10021a0f0a076368616e6e656c12046e616d652100b04cb01f' +
      'f771422a420a02696412046e616d651a0e0a056140622e6312054f776e6572221209' +
      '000000000000f03f1100000000000000402a087374616e6461726430053a066f7269' +
      '67696e'
  , values: {
      serial: 'serial'
    , status: 2
    , provider: {channel: 'channel', name: 'name'}
    , statusTimeStamp: 1234567890123
    , group: {
        id: 'id'
      , name: 'name'
      , owner: {email: 'a@b.c', name: 'Owner'}
      , lifeTime: {start: 1, stop: 2}
      , class: 'standard'
      , repetitions: 5
      , originName: 'origin'
      }
    }
  }
, {
    what: 'ConnectivityEvent with unset optionals'
  , type: 'ConnectivityEvent'
  , hex: '0a0673657269616c10011a0477696669'
  , values: {
      serial: 'serial'
    , connected: true
    , type: 'wifi'
    , subtype: null
    , failover: null
    , roaming: null
    }
  }
, {
    what: 'TouchDownMessage with float rounding'
  , type: 'TouchDownMessage'
  , hex: '080110021d80d6fc3d25e4d67c3f'
  , values: {
      seq: 1
    , contact: 2
    , x: 0.12345600128173828
    , y: 0.9876539707183838
    , pressure: null
    }
  }
, {
    what: 'LogcatStartMessage with no filters'
  , type: 'LogcatStartMessage'
  , hex: ''
  , values: {filters: []}
  }
, {
    what: 'LogcatStartMessage with one filter'
  , type: 'LogcatStartMessage'
  , hex: '0a070a037461671004'
  , values: {filters: [{tag: 'tag', priority: 4}]}
  }
, {
    what: 'GroupChangeMessage with repeated scalars and nested fields'
  , type: 'GroupChangeMessage'
  , hex: '0a560a02696412046e616d651a087374616e646172642204757365722a0e0a0561' +
      '40622e6312054f776e6572320d0a057374617274120473746f7038840740014a0673' +
      '657269616c52056140622e635a05726561647960011206616374696f6e1a05614062' +
      '2e632000280030013a056140622e6340004a0673657269616c5100b04cb01ff77142'
  , values: {
      group: {
        id: 'id'
      , name: 'name'
      , class: 'standard'
      , privilege: 'user'
      , owner: {email: 'a@b.c', name: 'Owner'}
      , dates: [{start: 'start', stop: 'stop'}]
      , duration: 900
      , repetitions: 1
      , devices: ['serial']
      , users: ['a@b.c']
      , state: 'ready'
      , isActive: true
      }
    , action: 'action'
    , subscribers: ['a@b.c']
    , isChangedDates: false
    , isChangedClass: false
    , isAddedUser: true
    , users: ['a@b.c']
    , isAddedDevice: false
    , devices: ['serial']
    , timeStamp: 1234567890123
    }
  }
, {
    what: 'DeviceIdentityMessage with unset optionals and nested messages'
  , type: 'DeviceIdentityMessage'
  , hex: '0a0673657269616c1207416e64726f69641a0c6d616e7566616374757265722a05' +
      '6d6f64656c3201393a0961726d36342d763861420232384a2a080010b80818800f20' +
      '002d0040d243350040d2433d0000704245000040404800520375726c5d0000b0405a' +
      '240a04696d65692a04696d736912066e756d6265721a05696363696422076e657477' +
      '6f726b'
  , values: {
      serial: 'serial'
    , platform: 'Android'
    , manufacturer: 'manufacturer'
    , operator: null
    , model: 'model'
    , version: '9'
    , abi: 'arm64-v8a'
    , sdk: '28'
    , display: {
        id: 0
      , width: 1080
      , height: 1920
      , rotation: 0
      , xdpi: 420.5
      , ydpi: 420.5
      , fps: 60
      , density: 3
      , secure: false
      , url: 'url'
      , size: 5.5
      }
    , phone: {
        imei: 'imei'
      , imsi: 'imsi'
      , phoneNumber: 'number'
      , iccid: 'iccid'
      , network: 'network'
      }
    , product: null
    , cpuPlatform: null
    , openGLESVersion: null
    , marketName: null
    }
  }
]

var pbjs5DevicePhoneMessageHex =
  '0a04696d65692a04696d736912066e756d6265721a05696363696422076e6574776f726b'
var tagOrderedDevicePhoneMessageHex =
  '0a04696d656912066e756d6265721a05696363696422076e6574776f726b2a04696d7369'

function fields(message) {
  return JSON.parse(JSON.stringify(message))
}

describe('wire protobuf', function() {
  describe('message construction', function() {
    it('should assign positional arguments in field declaration order', function() {
      expect(fields(new wire.TouchDownMessage(1, 2, 1.5, 2.5))).to.eql({
        seq: 1
      , contact: 2
      , x: 1.5
      , y: 2.5
      , pressure: null
      })
    })

    it('should assign a single field map argument', function() {
      expect(fields(new wire.AccountGetMessage({type: 'google'}))).to.eql({type: 'google'})
    })

    it('should reject a field map holding an unknown field', function() {
      expect(function() {
        return new wire.KeyDownMessage({nope: 'a'})
      }).to.throw(/is not a field/)
    })

    it('should reject more positional arguments than the message has fields', function() {
      expect(function() {
        return new wire.KeyDownMessage('a', 'b')
      }).to.throw(/has no field in position 2/)
    })

    it('should skip undefined positional arguments', function() {
      expect(fields(new wire.AccountRemoveMessage('google', undefined))).to.eql({
        type: 'google'
      , account: null
      })
    })

    it('should leave unset scalar fields null and unset repeated fields empty', function() {
      expect(fields(new wire.TransactionProgressMessage())).to.eql({
        source: null
      , seq: null
      , data: null
      , progress: null
      })
      expect(fields(new wire.LogcatStartMessage())).to.eql({filters: []})
    })

    it('should accept an enum value by name, as the ringer controls send it', function() {
      expect(fields(new wire.RingerSetMessage('SILENT'))).to.eql({mode: 0})
      expect(fields(new wire.RingerSetMessage('VIBRATE'))).to.eql({mode: 1})
      expect(fields(new wire.RingerSetMessage('NORMAL'))).to.eql({mode: 2})
    })

    it('should not mistake a nested message for a field map', function() {
      expect(new wire.UngroupMessage([
        new wire.DeviceRequirement('serial', 'abc', wire.RequirementType.EXACT)
      ]).requirements).to.have.lengthOf(1)
      expect(new wire.DeviceGroupChangeMessage(
        'id'
      , new wire.DeviceGroupMessage(
          'id'
        , 'name'
        , new wire.DeviceGroupOwnerMessage('a@b.c', 'Owner')
        , new wire.DeviceGroupLifetimeMessage(1, 2)
        , 'standard'
        , 5
        , 'origin'
        )
      , 'serial'
      ).group.name).to.equal('name')
    })
  })

  describe('message validation', function() {
    it('should reject a field value of the wrong type', function() {
      expect(function() {
        return new wire.KeyDownMessage(123).encodeNB()
      }).to.throw(/key: string expected/)
    })

    it('should reject a missing required field', function() {
      expect(function() {
        return new wire.TransactionDoneMessage('source').encodeNB()
      }).to.throw(/seq: integer expected/)
    })

    it('should reject a missing required field of a nested message', function() {
      expect(function() {
        return new wire.DeviceIntroductionMessage(
          'serial', wire.DeviceStatus.ONLINE, new wire.ProviderMessage(), 1
        ).encodeNB()
      }).to.throw(/provider\.channel: string expected/)
    })

    it('should reject an unknown enum value', function() {
      expect(function() {
        return new wire.DeviceStatusMessage('serial', 99, 1).encodeNB()
      }).to.throw(/status: enum value expected/)
    })
  })

  describe('message type codes', function() {
    it('should expose the type code on the class and on instances', function() {
      expect(wire.KeyDownMessage.$code).to.equal(12)
      expect(new wire.KeyDownMessage('a').$code).to.equal(12)
      expect(wire.DeviceIntroductionMessage.$code).to.equal(74)
    })

    it('should map every code back to its type name', function() {
      Object.keys(pbjs5MessageType).forEach(function(name) {
        expect(wire.ReverseMessageType[pbjs5MessageType[name]], name).to.equal(name)
      })
    })

    it('should expose a decoded message under its own type code', function() {
      var decoded = wire.KeyDownMessage.decode(new wire.KeyDownMessage('a').encodeNB())
      expect(decoded.$code).to.equal(12)
      expect(wireutil.envelope(decoded).toString('hex')).to.equal('080c12030a0161')
    })
  })

  describe('enum values', function() {
    it('should keep the MessageType values protobufjs 5 exposed', function() {
      expect(wire.MessageType).to.eql(pbjs5MessageType)
    })

    it('should keep the DeviceStatus values protobufjs 5 exposed', function() {
      expect(wire.DeviceStatus).to.eql({
        OFFLINE: 1
      , UNAUTHORIZED: 2
      , ONLINE: 3
      , CONNECTING: 4
      , AUTHORIZING: 5
      })
    })

    it('should keep the RequirementType values protobufjs 5 exposed', function() {
      expect(wire.RequirementType).to.eql({SEMVER: 1, GLOB: 2, EXACT: 3})
    })

    it('should keep the RingerMode values protobufjs 5 exposed', function() {
      expect(wire.RingerMode).to.eql({SILENT: 0, VIBRATE: 1, NORMAL: 2})
    })
  })

  describe('wire format', function() {
    it('should encode the same bytes protobufjs 5 encoded', function() {
      pbjs5Encodings.forEach(function(sample) {
        expect(sample.encode().toString('hex'), sample.what).to.equal(sample.hex)
      })
    })

    it('should return a Buffer from both encode and encodeNB', function() {
      var message = new wire.KeyDownMessage('a')
      expect(Buffer.isBuffer(message.encode())).to.be.true
      expect(Buffer.isBuffer(message.encodeNB())).to.be.true
      expect(message.encode().toString('hex')).to.equal(message.encodeNB().toString('hex'))
    })

    it('should decode bytes encoded by protobufjs 5 into the same field values', function() {
      pbjs5Decodings.forEach(function(sample) {
        expect(
          fields(wire[sample.type].decode(Buffer.from(sample.hex, 'hex')))
        , sample.what
        ).to.eql(sample.values)
      })
    })

    it('should decode an unset optional message field as null', function() {
      var encoded = new wire.DeviceIntroductionMessage(
        'serial', wire.DeviceStatus.ONLINE, new wire.ProviderMessage('chan', 'name'), 1
      ).encodeNB()
      expect(wire.DeviceIntroductionMessage.decode(encoded).group).to.be.null
    })

    it('should decode an unset repeated field as a mutable empty array', function() {
      var decoded = wire.LogcatStartMessage.decode(Buffer.alloc(0))
      expect(decoded.filters).to.eql([])
      expect(Object.isFrozen(decoded.filters)).to.be.false
      decoded.filters.push('anything')
      expect(decoded.filters).to.have.lengthOf(1)
    })

    it('should order DevicePhoneMessage fields by tag rather than by declaration', function() {
      expect(new wire.DevicePhoneMessage(
        'imei', 'imsi', 'number', 'iccid', 'network'
      ).encodeNB().toString('hex')).to.equal(tagOrderedDevicePhoneMessageHex)
    })

    it('should decode a DevicePhoneMessage protobufjs 5 encoded in declaration order',
      function() {
        expect(wire.DevicePhoneMessage.decode(
          Buffer.from(pbjs5DevicePhoneMessageHex, 'hex')
        )).to.eql(wire.DevicePhoneMessage.decode(
          Buffer.from(tagOrderedDevicePhoneMessageHex, 'hex')
        ))
      }
    )
  })

  describe('routing', function() {
    it('should deliver an envelope to the handler registered for its message class',
      function() {
        var seen = []
        var handler = wirerouter()
          .on(wire.TypeMessage, function(channel, message, data) {
            seen.push([channel, message.text, data.toString('hex')])
          })
          .handler()

        handler('fallback', wireutil.transaction('chan', new wire.TypeMessage('hello')))
        handler('fallback', wireutil.envelope(new wire.TypeMessage('plain')))

        expect(seen).to.eql([
          ['chan', 'hello', '081a12070a0568656c6c6f1a046368616e']
        , ['fallback', 'plain', '081a12070a05706c61696e']
        ])
      }
    )
  })

  describe('STFService wire', function() {
    var svc = protobuf.load(pathutil.module(
      '@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto'))
    var svcwire = protobuf.build(svc).jp.co.cyberagent.stf.proto

    it('should keep the enum values protobufjs 5 exposed', function() {
      expect(svcwire.RingerMode).to.eql({SILENT: 0, VIBRATE: 1, NORMAL: 2})
      expect(svcwire.ClipboardType).to.eql({TEXT: 1})
      expect(svcwire.KeyEvent).to.eql({DOWN: 0, UP: 1, PRESS: 2})
      expect(svcwire.MessageType.GET_DISPLAY).to.equal(19)
      expect(svcwire.MessageType.DO_TYPE).to.equal(3)
      expect(svcwire.MessageType.EVENT_ROTATION).to.equal(17)
    })

    it('should encode the same agent and service envelopes protobufjs 5 encoded', function() {
      expect(new svcwire.Envelope(
        null
      , svcwire.MessageType.DO_TYPE
      , new svcwire.DoTypeRequest('hello').encodeNB()
      ).encodeNB().toString('hex')).to.equal('10031a070a0568656c6c6f')

      expect(new svcwire.Envelope(
        123456
      , svcwire.MessageType.GET_DISPLAY
      , new svcwire.GetDisplayRequest(0).encodeNB()
      ).encodeNB().toString('hex')).to.equal('08c0c40710131a020800')

      expect(new svcwire.KeyEventRequest({
        event: svcwire.KeyEvent.PRESS
      , keyCode: 50
      , ctrlKey: true
      }).encodeNB().toString('hex')).to.equal('080210322001')
    })

    it('should decode an envelope without an id back to a null id', function() {
      var encoded = new svcwire.Envelope(
        null
      , svcwire.MessageType.EVENT_ROTATION
      , new svcwire.RotationEvent(270).encodeNB()
      ).encodeNB()
      expect(svcwire.Envelope.decode(encoded).id).to.be.null
    })

    it('should decode an envelope with an id back to that id', function() {
      var encoded = new svcwire.Envelope(
        123456
      , svcwire.MessageType.GET_DISPLAY
      , new svcwire.GetDisplayRequest(0).encodeNB()
      ).encodeNB()
      expect(svcwire.Envelope.decode(encoded).id).to.equal(123456)
    })

    it('should resolve a ringer mode back to its enum name by reflection', function() {
      var mode = svc.lookupEnum('jp.co.cyberagent.stf.proto.RingerMode')
      expect([0, 1, 2].map(function(value) {
        return mode.valuesById[value]
      })).to.eql(['SILENT', 'VIBRATE', 'NORMAL'])
    })
  })
})
