import EventEmitter from 'node:events'
import type {ChildProcess} from 'node:child_process'

import {expect} from 'chai'
import sinon from 'sinon'
import adbkit from '@devicefarmer/adbkit'

import provider from '../../lib/units/provider/index.js'
import lifecycle from '../../lib/util/lifecycle.js'
import zmqutil from '../../lib/util/zmqutil.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'

type FakeSocket = EventEmitter & {
  connect: sinon.SinonSpy
  subscribe: sinon.SinonSpy
  send: sinon.SinonSpy
  close: sinon.SinonSpy
}

type FakeProc = EventEmitter & {kill: sinon.SinonSpy}

function fakeSocket() {
  var socket = new EventEmitter() as FakeSocket
  socket.connect = sinon.spy()
  socket.subscribe = sinon.spy()
  socket.send = sinon.spy()
  socket.close = sinon.spy()
  return socket
}

function wait(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

describe('Provider', function() {
  var push: FakeSocket, sub: FakeSocket, tracker: EventEmitter, procs: FakeProc[]
    , fork: sinon.SinonSpy, cleanup: (() => unknown) | null

  beforeEach(async function() {
    push = fakeSocket()
    sub = fakeSocket()
    tracker = new EventEmitter()
    procs = []
    cleanup = null
    sinon.stub(zmqutil, 'socket').callsFake(function(type: string) {
      return (type === 'push' ? push : sub) as unknown as ReturnType<typeof zmqutil.socket>
    })
    sinon.stub(lifecycle, 'share')
    sinon.stub(lifecycle, 'observe').callsFake(function(fn) {
      cleanup = fn
    })
    sinon.stub(adbkit.Adb, 'createClient').returns({
      trackDevices: function() {
        return Promise.resolve(tracker)
      }
    } as unknown as ReturnType<typeof adbkit.Adb.createClient>)
    fork = sinon.spy(function() {
      var proc = new EventEmitter() as FakeProc
      proc.kill = sinon.spy(function(signal: NodeJS.Signals) {
        setImmediate(function() {
          proc.emit('exit', null, signal)
        })
      })
      procs.push(proc)
      return proc as unknown as ChildProcess
    })

    provider({
      name: 'test-provider'
    , killTimeout: 1000
    , ports: [7400, 7401, 7402, 7403, 7404, 7405, 7406, 7407]
    , allowRemote: false
    , fork: fork
    , endpoints: {sub: [], push: []}
    , adbHost: '127.0.0.1'
    , adbPort: 5037
    })

    // Let the provider attach its listeners to the tracker
    await wait(10)
  })

  afterEach(async function() {
    if (cleanup) {
      await cleanup()
    }
    sinon.restore()
  })

  function sent<T>(type: {$code: number, decode(buffer: Uint8Array): T}): T[] {
    return push.send.args
      .map(function(args) {
        return wire.Envelope.decode(args[0][1])
      })
      .filter(function(envelope) {
        return envelope.type === type.$code
      })
      .map(function(envelope) {
        return type.decode(envelope.message)
      })
  }

  function register(serial: string) {
    sub.emit('message', 'channel', wireutil.envelope(new wire.DeviceRegisteredMessage(serial)))
  }

  // check() waits 100ms before it starts or stops a worker
  function settle() {
    return wait(200)
  }

  it('should introduce a device first seen in an unsupported adb state', async function() {
    tracker.emit('add', {id: 'serial1', type: 'recovery'})

    var introductions = sent(wire.DeviceIntroductionMessage)
    expect(introductions).to.have.length(1)
    expect(introductions[0]!.serial).to.equal('serial1')
    expect(introductions[0]!.status).to.equal(wire.DeviceStatus.OFFLINE)

    register('serial1')
    await settle()
    expect(fork.called).to.equal(false)

    tracker.emit('change', {id: 'serial1', type: 'device'})
    await settle()
    var statuses = sent(wire.DeviceStatusMessage)
    expect(statuses).to.have.length(1)
    expect(statuses[0]!.status).to.equal(wire.DeviceStatus.ONLINE)
    expect(fork.calledOnce).to.equal(true)
  })

  it('should forget a device that is removed while in an unsupported adb state',
    async function() {
      tracker.emit('add', {id: 'serial1', type: 'no permissions (missing udev rules)'})
      register('serial1')
      await settle()

      tracker.emit('remove', {id: 'serial1', type: 'no permissions (missing udev rules)'})
      await settle()

      var absences = sent(wire.DeviceAbsentMessage)
      expect(absences).to.have.length(1)
      expect(absences[0]!.serial).to.equal('serial1')
    }
  )

  it('should stop the worker when an online device switches to an unsupported adb state',
    async function() {
      tracker.emit('add', {id: 'serial1', type: 'device'})
      register('serial1')
      await settle()
      expect(fork.calledOnce).to.equal(true)

      tracker.emit('change', {id: 'serial1', type: 'recovery'})
      await settle()

      var statuses = sent(wire.DeviceStatusMessage)
      expect(statuses).to.have.length(1)
      expect(statuses[0]!.status).to.equal(wire.DeviceStatus.OFFLINE)
      expect(procs[0]!.kill.calledWith('SIGTERM')).to.equal(true)

      tracker.emit('change', {id: 'serial1', type: 'device'})
      await settle()

      // One worker again, the first one is gone
      expect(fork.calledTwice).to.equal(true)
      expect(procs[1]!.kill.called).to.equal(false)
    }
  )
})
