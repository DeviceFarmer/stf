import {PassThrough} from 'node:stream'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import protobuf from '../../lib/wire/protobuf.js'
import pathutil from '../../lib/util/pathutil.js'
import devutil from '../../lib/util/devutil.js'
import lifecycle from '../../lib/util/lifecycle.js'
import service from '../../lib/units/device/plugins/service.js'
import type {ServicePlugin} from '../../lib/types/device-plugins.js'

const builder = protobuf.load(pathutil.module(
  '@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto'))
const proto = (protobuf.build(builder) as any).jp.co.cyberagent.stf.proto

interface FakeConn extends PassThrough {
  sock?: string
  written: Buffer[]
}

function fakeConn(): FakeConn {
  const conn = Object.assign(new PassThrough(), {written: [] as Buffer[]})
  conn.on('data', (chunk: Buffer) => conn.written.push(chunk))
  return conn
}

function endedStream() {
  const out = new PassThrough()
  out.end()
  return out
}

async function setup() {
  const sockets: Record<string, FakeConn[]> = {
    'localabstract:stfagent': []
  , 'localabstract:stfservice': []
  }
  const killed = sinon.stub(devutil, 'killProcsByComm').callsFake(() => Bluebird.resolve())
  sinon.stub(devutil, 'ensureUnusedLocalSocket').callsFake(
    (_adb, _serial, sock) => Bluebird.resolve(sock))
  sinon.stub(devutil, 'waitForLocalSocket').callsFake((_adb, _serial, sock) => {
    const conn = fakeConn()
    conn.sock = sock
    sockets[sock]!.push(conn)
    return Bluebird.resolve(conn as any)
  })
  const shell = sinon.stub().callsFake(() => Bluebird.resolve(endedStream()))
  const adb = {shell, Keycode: {KEYCODE_V: 50}}
  const router = {on: () => router}
  const push = {send: sinon.spy()}
  const apk = {
    path: '/data/app/stf.apk'
  , main: 'jp.co.cyberagent.stf.Agent'
  , wire: proto
  , startIntent: {action: 'jp.co.cyberagent.stf.ACTION_START'
    , component: 'jp.co.cyberagent.stf/.Service'}
  }
  const plugin = await (service as any).invoke(
    {serial: 'emulator-5554'}, adb, router, push, {level: 30}, apk
  ) as ServicePlugin
  return {plugin, sockets, killed, shell}
}

// Only for asserting that something did NOT happen; use until() otherwise.
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
  expect(condition()).to.equal(true, 'Condition was not met in time')
}

describe('Device service plugin agent connection', function() {
  let fatal: sinon.SinonStub

  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
    fatal = sinon.stub(lifecycle, 'fatal')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('relaunches the agent, not the service, when the agent connection ends', async function() {
    const {plugin, sockets, killed, shell} = await setup()
    const agents = sockets['localabstract:stfagent']!
    expect(agents).to.have.length(1)
    expect(sockets['localabstract:stfservice']).to.have.length(1)
    const serviceStarts = shell.getCalls().filter(call => /\bam\b/.test(String(call.args[1])))
    expect(serviceStarts).to.have.length(1)

    agents[0]!.emit('end')
    await until(() => agents.length === 2)

    expect(fatal.called).to.equal(false)
    expect(killed.callCount).to.equal(2, 'The stale agent is stopped before relaunching')
    expect(agents).to.have.length(2)
    expect(sockets['localabstract:stfservice']).to.have.length(1)
    expect(shell.getCalls().filter(call => /\bam\b/.test(String(call.args[1]))))
      .to.have.length(1, 'The service is not restarted')

    plugin.type('after relaunch')
    await until(() => agents[1]!.written.length > 0)
  })

  it('drops commands while the agent is being relaunched', async function() {
    const {plugin, sockets} = await setup()
    const agents = sockets['localabstract:stfagent']!
    const before = agents[0]!.written.length
    // Keep the relaunch pending so commands arrive while there is no agent.
    let release!: () => void
    ;(devutil.killProcsByComm as sinon.SinonStub).callsFake(() =>
      new Bluebird<void>(resolve => {
        release = resolve
      }))

    agents[0]!.emit('end')
    expect(() => plugin.type('lost')).not.to.throw()
    expect(() => plugin.pressKey('home')).not.to.throw()
    agents[0]!.emit('error', new Error('This socket has been ended by the other party'))
    await settle()
    expect(agents[0]!.written.length).to.equal(before, 'Nothing is written to the dead agent')
    expect(fatal.called).to.equal(false)

    release()
    await until(() => agents.length === 2)
    plugin.type('back')
    await until(() => agents[1]!.written.length > 0)
  })

  it('relaunches only once for repeated end events', async function() {
    const {sockets} = await setup()
    const agents = sockets['localabstract:stfagent']!
    agents[0]!.emit('end')
    agents[0]!.emit('end')
    await until(() => agents.length === 2)
    await settle()
    expect(agents).to.have.length(2)
  })

  it('is fatal when the relaunch fails', async function() {
    const {sockets} = await setup()
    ;(devutil.killProcsByComm as sinon.SinonStub).callsFake(
      () => Bluebird.reject(new Error('device offline')))

    sockets['localabstract:stfagent']![0]!.emit('end')
    await until(() => fatal.calledOnce)
    expect(sockets['localabstract:stfagent']).to.have.length(1)
  })

  describe('with a stuck relaunch', function() {
    let clock: sinon.SinonFakeTimers

    afterEach(function() {
      clock.restore()
    })

    it('is fatal once a relaunch step hangs past its own limit', async function() {
      const {sockets} = await setup()
      ;(devutil.killProcsByComm as sinon.SinonStub).callsFake(() => new Bluebird<void>(() => {}))
      clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      sockets['localabstract:stfagent']![0]!.emit('end')
      await clock.tickAsync(14000)
      expect(fatal.called).to.equal(false)
      await clock.tickAsync(2000)
      expect(fatal.calledOnce).to.equal(true)
    })

    it('does not cut short a slow relaunch that stays within every step limit', async function() {
      const {sockets, shell} = await setup()
      ;(devutil.killProcsByComm as sinon.SinonStub).callsFake(() => Bluebird.delay(14900))
      shell.callsFake(() => Bluebird.delay(9900).then(endedStream))
      ;(devutil.ensureUnusedLocalSocket as sinon.SinonStub).callsFake(
        (_adb: unknown, _serial: string, sock: string) => Bluebird.delay(9900).return(sock))
      const wait = devutil.waitForLocalSocket as sinon.SinonStub
      wait.callsFake((_adb: unknown, _serial: string, sock: string) =>
        Bluebird.delay(9900).then(() => {
          const conn = fakeConn()
          conn.sock = sock
          sockets[sock]!.push(conn)
          return conn as any
        }))
      clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

      sockets['localabstract:stfagent']![0]!.emit('end')
      await clock.tickAsync(60000)
      expect(fatal.called).to.equal(false)
      expect(sockets['localabstract:stfagent']).to.have.length(2)
    })
  })

  it('still treats an error on the live agent connection as fatal', async function() {
    const {sockets} = await setup()
    sockets['localabstract:stfagent']![0]!.emit('error', new Error('boom'))
    expect(fatal.calledOnce).to.equal(true)
  })
})
