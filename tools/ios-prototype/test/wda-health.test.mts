import assert from 'node:assert/strict'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {afterEach, describe, it} from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'

import {IosRuntime} from '../runtime.mts'
import type {RuntimeDependencies, RuntimeOptions} from '../runtime.mts'
import {WdaClient} from '../wda.mts'

const cleanups: Array<() => Promise<unknown>> = []

afterEach(async() => {
  for (const close of cleanups.splice(0).reverse()) {
    await close()
  }
})

async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for WDA lifecycle')
    await delay(5)
  }
}

async function fixture(inputTimeout = 100, healthTimeout = 500) {
  const calls: Array<{method: string, path: string}> = []
  const children: Array<{failure: Error | null, stopped: boolean, stop(): Promise<void>}> = []
  let sessions = 0
  let locked = false
  let mode: 'ready' | 'blocked' | 'invalid' | 'hung' | 'slow-checks' = 'ready'
  let release: () => void = () => {}
  let blocked: Promise<void> = Promise.resolve()
  const server = http.createServer(async(req, res) => {
    req.resume()
    calls.push({method: req.method!, path: req.url!})
    const session = req.method === 'GET' && /^\/session\/[^/]+$/.test(req.url!)
    const lock = req.url!.endsWith('/wda/locked')
    res.setHeader('Content-Type', 'application/json')
    if (session && mode === 'invalid') {
      mode = 'ready'
      res.writeHead(404)
      res.end(JSON.stringify({value: {error: 'invalid session id', message: 'Session is gone'}}))
      return
    }
    if (session && mode === 'hung') {
      mode = 'ready'
      return
    }
    if (mode === 'blocked' && req.url!.startsWith('/session/') && req.method !== 'DELETE') {
      await blocked
    }
    if (mode === 'slow-checks' && (session || lock)) {
      await delay(300)
    }
    if (res.destroyed) {
      return
    }
    let value: unknown = {ready: true}
    if (req.url === '/session' && req.method === 'POST') {
      value = {sessionId: 'owned-' + ++sessions}
    }
    else if (lock) {
      value = locked
    }
    else if (req.url!.endsWith('/source')) {
      value = '<source/>'
    }
    res.end(JSON.stringify({value}))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeAllConnections()
    release()
  }))
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  const wda = new WdaClient(origin, inputTimeout, healthTimeout)
  const options: RuntimeOptions = {
    udid: 'selected-phone', bundleId: 'test.wda.xctrunner'
  , xctest: 'WebDriverAgentRunner.xctest', goIos: 'ios', iproxy: 'iproxy'
  , imageMounter: 'go-ios', pymobiledevice3: 'pymobiledevice3'
  , wdaPort: 18100, mjpegPort: 19100, tunnelPort: 28100, retryMs: 10, startupMs: 500
  }
  const dependencies: Partial<RuntimeDependencies> = {
    wda, log: () => {}, run: async() => ''
  , json: async(_binary, args) => {
      if (args[0] === 'list') {
        return {deviceList: [options.udid]}
      }
      if (args.includes('ls')) {
        return [{udid: options.udid, address: 'fd00::1', rsdPort: 58783}]
      }
      return {ProductVersion: '27.0.1'}
    }
  , start: () => {
      const child = {failure: null, stopped: false, stop: async() => {
        child.stopped = true
      }}
      children.push(child)
      return child
    }
  }
  const runtime = new IosRuntime(options, dependencies)
  cleanups.push(() => runtime.stop())
  runtime.start()
  await until(() => runtime.state === 'ready')
  return {runtime, wda, origin, calls, children, sessions: () => sessions
  , healthStarted: () => calls.some(call =>
      call.method === 'GET' && /^\/session\/[^/]+$/.test(call.path))
  , deleted: () => calls.some(call => call.method === 'DELETE')
  , setMode: (value: typeof mode) => {
      calls.length = 0
      mode = value
      if (value === 'blocked') {
        blocked = new Promise<void>(resolve => {
          release = resolve
        })
      }
    }
  , unblock: () => {
      mode = 'ready'
      release()
    }
  , lock: () => {
      locked = true
    }}
}

describe('WDA session health budget', () => {
  it('keeps its session during a source command longer than the input timeout', async() => {
    const f = await fixture()
    f.setMode('blocked')
    const source = fetch(f.origin + '/session/' + f.wda.sessionId + '/source')
    source.catch(() => null)
    cleanups.push(async() => {
      f.unblock()
      await source
    })
    await until(() => f.healthStarted())
    await assert.rejects(f.wda.call('POST', '/wda/keys', {value: ['text']}), {name: 'TimeoutError'})
    await delay(40)
    assert.equal(f.runtime.state, 'ready')
    assert.equal(f.runtime.generation, 0)
    assert.equal(f.deleted(), false)
    assert.equal(f.sessions(), 1)

    f.lock()
    f.unblock()
    assert.equal((await (await source).json() as {value: string}).value, '<source/>')
    await until(() => f.runtime.telemetry.status.locked === true)
    assert.equal(f.runtime.state, 'ready')
    assert.equal(f.runtime.generation, 0)
    assert.equal(f.wda.sessionId, 'owned-1')
    assert.equal(f.deleted(), false)
  })

  it('recovers immediately when the actual session is invalid', async() => {
    const f = await fixture(100, 5000)
    f.setMode('invalid')
    await until(() => f.runtime.generation > 0)
    assert.equal(f.runtime.lastError, 'Session is gone')
    await until(() => f.deleted() && f.children.slice(0, 2).every(child => child.stopped))
    await until(() => f.sessions() === 2 && f.runtime.state === 'ready')
  })

  it('still recovers when a health request never responds', async() => {
    const f = await fixture()
    f.setMode('hung')
    await until(() => f.healthStarted())
    await delay(150)
    assert.equal(f.runtime.generation, 0)
    assert.equal(f.deleted(), false)
    await until(() => f.runtime.generation > 0)
    assert.match(f.runtime.lastError!, /timeout/i)
    await until(() => f.deleted() && f.children.slice(0, 2).every(child => child.stopped))
    await until(() => f.sessions() === 2 && f.runtime.state === 'ready')
  })

  it('shares one finite budget across the session and lock checks', async() => {
    const f = await fixture()
    f.setMode('slow-checks')
    await until(() => f.runtime.generation > 0)
    assert.ok(f.calls.some(call => call.path.endsWith('/wda/locked')))
    assert.match(f.runtime.lastError!, /timeout/i)
    await until(() => f.deleted())
  })

  it('cancels an in-flight health check when the runtime stops', async() => {
    const f = await fixture(100, 5000)
    f.setMode('hung')
    await until(() => f.healthStarted())
    const stopped = f.runtime.stop()
    await until(() => f.runtime.state === 'stopped')
    await stopped
    assert.equal(f.deleted(), true)
    assert.ok(f.children.every(child => child.stopped))
    assert.equal(f.sessions(), 1)
  })
})
