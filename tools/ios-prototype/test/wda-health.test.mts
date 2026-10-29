import assert from 'node:assert/strict'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {afterEach, describe, it} from 'node:test'
import type {TestContext} from 'node:test'
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

async function until(predicate: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for WDA lifecycle')
    await delay(5)
  }
}

function controlledTimeouts(t: TestContext) {
  let now = 0
  const deadlines: Array<{at: number, controller: AbortController}> = []
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    const controller = new AbortController()
    deadlines.push({at: now + ms, controller})
    return controller.signal
  })
  return {advance: (ms: number) => {
    now += ms
    for (const deadline of deadlines) {
      if (deadline.at <= now) {
        deadline.controller.abort(new DOMException('WDA request timeout', 'TimeoutError'))
      }
    }
  }}
}

async function fixture(t: TestContext, {healthTimeout = 500, retrySetup = false} = {}) {
  // Restore mocks only after the runtime and its HTTP connections have stopped.
  cleanups.push(async() => t.mock.restoreAll())
  const clock = controlledTimeouts(t)
  const calls: Array<{method: string, path: string}> = []
  const children: Array<{failure: Error | null, stopped: boolean, stop(): Promise<void>}> = []
  const healthSignals: AbortSignal[] = []
  let sessions = 0
  let locked = false
  let mode: 'ready' | 'blocked' | 'invalid' | 'hung' | 'slow-checks' = 'ready'
  let pendingHealth: AbortSignal | null = null
  let pendingLock = false
  let gatedSession = false
  let release: () => void = () => {}
  let blocked: Promise<void> = Promise.resolve()
  let releaseSession: () => void = () => {}
  let sessionGate: Promise<void> = Promise.resolve()
  let releaseLock: () => void = () => {}
  let lockGate: Promise<void> = Promise.resolve()
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
    if ((session || lock) && mode === 'hung') {
      pendingHealth = healthSignals.at(-1)!
      mode = 'ready'
      return
    }
    if (mode === 'blocked' && req.url!.startsWith('/session/') && req.method !== 'DELETE') {
      if (session || lock) {
        pendingHealth = healthSignals.at(-1)!
      }
      await blocked
    }
    if (mode === 'slow-checks' && session) {
      gatedSession = true
      pendingHealth = healthSignals.at(-1)!
      await sessionGate
    }
    if (mode === 'slow-checks' && lock && gatedSession) {
      pendingLock = true
      await lockGate
    }
    if (res.destroyed) {
      return
    }
    let value: unknown = {ready: true}
    if (req.url === '/session' && req.method === 'POST') {
      value = {sessionId: 'owned-' + ++sessions}
      if (retrySetup && sessions === 1) {
        children.at(-1)!.failure = new Error('Runner failed during setup')
      }
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
    releaseSession()
    releaseLock()
  }))
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  const request = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (...args: Parameters<typeof fetch>) => {
    const [url, init] = args
    if (typeof url === 'string' && url.startsWith(origin) && init?.signal &&
        init.method === 'GET' &&
        /^\/session\/[^/]+(?:\/wda\/locked)?$/.test(new URL(url).pathname)) {
      healthSignals.push(init.signal)
    }
    return request(...args)
  })
  const wda = new WdaClient(origin, 100, healthTimeout)
  const options: RuntimeOptions = {
    udid: 'selected-phone', bundleId: 'test.wda.xctrunner'
  , xctest: 'WebDriverAgentRunner.xctest', goIos: 'ios', iproxy: 'iproxy'
  , imageMounter: 'go-ios', pymobiledevice3: 'pymobiledevice3'
  , wdaPort: 18100, mjpegPort: 19100, tunnelPort: 28100, retryMs: 10, startupMs: 5000
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
  cleanups.push(async() => {
    const stopped = runtime.stop()
    clock.advance(healthTimeout)
    server.closeAllConnections()
    await stopped
  })
  runtime.start()
  await until(() => runtime.state === 'ready')
  const baseline = {generation: runtime.generation, sessionId: wda.sessionId, sessions
    , children: children.filter(child => !child.stopped)}
  return {runtime, wda, origin, calls, children, clock, baseline, sessions: () => sessions
  , healthStarted: () => pendingHealth !== null
  , healthSignal: () => pendingHealth!
  , lockStarted: () => pendingLock
  , deleted: () => calls.some(call => call.method === 'DELETE')
  , setMode: (value: typeof mode) => {
      calls.length = 0
      pendingHealth = null
      mode = value
      if (value === 'blocked') {
        blocked = new Promise<void>(resolve => {
          release = resolve
        })
      }
      if (value === 'slow-checks') {
        sessionGate = new Promise<void>(resolve => {
          releaseSession = resolve
        })
        lockGate = new Promise<void>(resolve => {
          releaseLock = resolve
        })
      }
    }
  , unblock: () => {
      mode = 'ready'
      release()
    }
  , lock: () => {
      locked = true
    }
  , releaseSession: () => releaseSession()}
}

describe('WDA session health budget', () => {
  it('keeps its session during a source command longer than the input timeout', async(t) => {
    const f = await fixture(t, {retrySetup: true})
    f.setMode('blocked')
    const source = fetch(f.origin + '/session/' + f.wda.sessionId + '/source')
    source.catch(() => null)
    cleanups.push(async() => {
      f.unblock()
      await source.catch(() => null)
    })
    await until(() => f.healthStarted())
    const input = assert.rejects(f.wda.call('POST', '/wda/keys', {value: ['text']}),
      {name: 'TimeoutError'})
    await until(() => f.calls.some(call => call.path.endsWith('/wda/keys')) &&
      f.calls.some(call => call.path.endsWith('/source')))
    f.clock.advance(101)
    await input
    assert.equal(f.healthSignal().aborted, false)
    assert.equal(f.runtime.state, 'ready')
    assert.equal(f.runtime.generation, f.baseline.generation)
    assert.equal(f.deleted(), false)
    assert.equal(f.sessions(), f.baseline.sessions)

    f.lock()
    f.unblock()
    assert.equal((await (await source).json() as {value: string}).value, '<source/>')
    await until(() => f.runtime.telemetry.status.locked === true)
    assert.equal(f.runtime.state, 'ready')
    assert.equal(f.runtime.generation, f.baseline.generation)
    assert.equal(f.wda.sessionId, f.baseline.sessionId)
    assert.equal(f.deleted(), false)
  })

  it('recovers immediately when the actual session is invalid', async(t) => {
    const f = await fixture(t, {healthTimeout: 5000})
    f.setMode('invalid')
    await until(() => f.runtime.generation > f.baseline.generation)
    assert.equal(f.runtime.lastError, 'Session is gone')
    await until(() => f.deleted() && f.baseline.children.every(child => child.stopped))
    await until(() => f.sessions() === f.baseline.sessions + 1 && f.runtime.state === 'ready')
  })

  it('still recovers when a health request never responds', async(t) => {
    const f = await fixture(t)
    f.setMode('hung')
    await until(() => f.healthStarted())
    f.clock.advance(101)
    assert.equal(f.healthSignal().aborted, false)
    assert.equal(f.runtime.generation, f.baseline.generation)
    assert.equal(f.deleted(), false)
    f.clock.advance(399)
    await until(() => f.runtime.generation > f.baseline.generation)
    assert.match(f.runtime.lastError!, /timeout/i)
    await until(() => f.deleted() && f.baseline.children.every(child => child.stopped))
    await until(() => f.sessions() === f.baseline.sessions + 1 && f.runtime.state === 'ready')
  })

  it('shares one finite budget across the session and lock checks', async(t) => {
    const f = await fixture(t)
    f.setMode('slow-checks')
    await until(() => f.healthStarted())
    f.clock.advance(300)
    f.releaseSession()
    await until(() => f.lockStarted())
    f.clock.advance(200)
    await until(() => f.runtime.generation > f.baseline.generation)
    assert.match(f.runtime.lastError!, /timeout/i)
    await until(() => f.deleted())
  })

  it('cancels an in-flight health check when the runtime stops', async(t) => {
    const f = await fixture(t, {healthTimeout: 5000})
    f.setMode('hung')
    await until(() => f.healthStarted())
    const stopped = f.runtime.stop()
    await until(() => f.runtime.state === 'stopped')
    await stopped
    assert.equal(f.deleted(), true)
    assert.ok(f.children.every(child => child.stopped))
    assert.equal(f.sessions(), f.baseline.sessions)
  })
})
