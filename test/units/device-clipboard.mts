import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Duplex, PassThrough} from 'node:stream'

import {expect} from 'chai'
import Promise from 'bluebird'
import sinon from 'sinon'

import pathutil from '../../lib/util/pathutil.js'
import protobuf from '../../lib/wire/protobuf.js'
import ms from '../../lib/wire/messagestream.js'
import serviceSyrup from '../../lib/units/device/plugins/service.js'

interface Envelope {
  id: number | null
  type: number
  message: Buffer
}

interface Wire {
  MessageType: Record<string, number>
  ClipboardType: Record<string, number>
  Envelope: {
    new(id: number | null, type: number, message: Buffer): {encode(): Buffer}
    decode(buffer: Buffer): Envelope
  }
  GetClipboardResponse: {
    new(success: boolean, type: number | null, text: string | null): {encode(): Buffer}
  }
}

type Reply = {success: boolean, text?: string | null} | null

interface DeviceOptions {
  // Whether the wire definition, and so the APK it ships with, has the request
  agentClipboard: boolean
  sdk: number
  // What each side says when asked for the clipboard, null to stay silent
  service?: Reply
  agent?: Reply
}

var AGENT_GET_CLIPBOARD = 33
var released = fs.readFileSync(pathutil.module(
  '@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto'), 'utf8')
var directory: string

// The tests must hold both before and after the stfservice-prebuilt release
// that brings the request, so each definition is derived from the installed one.
function loadWire(agentClipboard: boolean): Wire {
  var proto = released.replace(/^.*\bAGENT_GET_CLIPBOARD\b.*;\n/m, '')
  if (agentClipboard) {
    proto = proto.replace(
      /(enum MessageType \{)/
    , '$1\n    AGENT_GET_CLIPBOARD = ' + AGENT_GET_CLIPBOARD + ';'
    )
  }
  var file = path.join(directory, agentClipboard ? 'with.proto' : 'without.proto')
  fs.writeFileSync(file, proto)
  var built = protobuf.build(protobuf.load(file)) as unknown as
    {jp: {co: {cyberagent: {stf: {proto: Wire}}}}}
  return built.jp.co.cyberagent.stf.proto
}

function ended(text: string) {
  var out = new PassThrough()
  out.end(text)
  return out
}

// One end of a local socket, with the device on the other end
function deviceSocket(wire: Wire, respond: (envelope: Envelope) => Reply) {
  var received = new ms.DelimitedStream()
  var fromDevice = new ms.DelimitingStream()
  var requests: Envelope[] = []
  var conn = new Duplex({
    read: function() {
      // Pushed as the device answers
    }
  , write: function(chunk, encoding, callback) {
      received.write(chunk, encoding, callback)
    }
  })
  fromDevice.on('data', function(chunk: Buffer) {
    conn.push(chunk)
  })
  received.on('data', function(frame: Buffer) {
    var envelope = wire.Envelope.decode(frame)
    requests.push(envelope)
    var reply = respond(envelope)
    if (reply) {
      fromDevice.write(new wire.Envelope(
        envelope.id
      , envelope.type
      , new wire.GetClipboardResponse(
          reply.success
        , reply.success ? wire.ClipboardType.TEXT! : null
        , 'text' in reply ? reply.text : null
        ).encode()
      ).encode())
    }
  })
  return {conn: conn, requests: requests}
}

async function connect(options: DeviceOptions) {
  var wire = loadWire(options.agentClipboard)
  var service = deviceSocket(wire, function() {
    return 'service' in options ? options.service! : {success: true, text: 'from service'}
  })
  var agent = deviceSocket(wire, function(envelope) {
    if (envelope.type !== AGENT_GET_CLIPBOARD) {
      return null
    }
    return 'agent' in options ? options.agent! : {success: true, text: 'from agent'}
  })
  var agentRunning = false
  var adb = {
    Keycode: {KEYCODE_V: 50}
  , shell: function(serial: string, command: string | string[]) {
      if (String(command).indexOf('app_process') !== -1) {
        agentRunning = true
        return Promise.resolve(new PassThrough())
      }
      return Promise.resolve(ended(
        String(command).indexOf('ps ') === 0 ? 'USER PID NAME\nroot 1 init\n' : ''
      ))
    }
  , openLocal: function(serial: string, sock: string) {
      if (sock === 'localabstract:stfservice') {
        return Promise.resolve(service.conn)
      }
      return agentRunning ?
        Promise.resolve(agent.conn) :
        Promise.reject(new Error('closed'))
    }
  }
  var router = {
    on: function() {
      return router
    }
  }
  var plugin = await serviceSyrup.invoke(
    {serial: 'test-device'} as Parameters<typeof serviceSyrup.invoke>[0]
  , adb as unknown as Parameters<typeof serviceSyrup.invoke>[1]
  , router as unknown as Parameters<typeof serviceSyrup.invoke>[2]
  , {send: sinon.stub()} as unknown as Parameters<typeof serviceSyrup.invoke>[3]
  , {level: options.sdk}
  , {
      wire: wire
    , path: '/data/app/stf.apk'
    , main: 'jp.co.cyberagent.stf.Agent'
    , startIntent: {action: 'start', component: 'stf/.Service'}
    } as unknown as Parameters<typeof serviceSyrup.invoke>[5]
  )
  return {plugin: plugin, wire: wire, service: service, agent: agent}
}

describe('device clipboard', function() {
  before(function() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-clipboard-'))
  })

  after(function() {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  afterEach(function() {
    sinon.restore()
  })

  it('should ask the agent on Android 10 when the APK has the request', async function() {
    var device = await connect({agentClipboard: true, sdk: 29})

    expect(await device.plugin.copy()).to.equal('from agent')
    expect(device.agent.requests).to.have.length(1)
    expect(device.agent.requests[0]!.type).to.equal(AGENT_GET_CLIPBOARD)
    expect(device.agent.requests[0]!.id).to.be.a('number')
    expect(device.service.requests).to.have.length(0)
  })

  it('should pass an empty clipboard on from the agent', async function() {
    var device = await connect({agentClipboard: true, sdk: 34, agent: {success: true}})

    expect(await device.plugin.copy()).to.equal(null)
    expect(device.service.requests).to.have.length(0)
  })

  it('should not send the request to an agent whose APK lacks it', async function() {
    var device = await connect({agentClipboard: false, sdk: 34})
    var clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    // With the timers frozen this only resolves if nothing waits for the agent
    expect(await device.plugin.copy()).to.equal('from service')
    expect(clock.countTimers()).to.equal(0)
    expect(device.agent.requests).to.have.length(0)
    expect(device.service.requests).to.have.length(1)
    expect(device.service.requests[0]!.type).to.equal(device.wire.MessageType.GET_CLIPBOARD)
  })

  it('should keep asking the service before Android 10', async function() {
    var device = await connect({agentClipboard: true, sdk: 28})

    expect(await device.plugin.copy()).to.equal('from service')
    expect(device.agent.requests).to.have.length(0)
    expect(device.service.requests).to.have.length(1)
  })

  it('should ask the service when the agent fails', async function() {
    var device = await connect({agentClipboard: true, sdk: 34, agent: {success: false}})

    expect(await device.plugin.copy()).to.equal('from service')
    expect(device.agent.requests).to.have.length(1)
    expect(device.service.requests).to.have.length(1)
  })

  it('should ask the service when the agent does not answer', async function() {
    var device = await connect({agentClipboard: true, sdk: 34, agent: null})
    var clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    var copied = device.plugin.copy()

    await new Promise(function(resolve) {
      setImmediate(resolve)
    })
    expect(device.agent.requests).to.have.length(1)
    expect(device.service.requests).to.have.length(0)

    clock.tick(5000)
    expect(await copied).to.equal('from service')
    expect(device.service.requests).to.have.length(1)
  })

  it('should set the clipboard through the service on every version', async function() {
    var device = await connect({agentClipboard: true, sdk: 34, service: {success: true}})

    await device.plugin.setClipboard('text')
    expect(device.agent.requests).to.have.length(0)
    expect(device.service.requests).to.have.length(1)
    expect(device.service.requests[0]!.type).to.equal(device.wire.MessageType.SET_CLIPBOARD)
  })
})
