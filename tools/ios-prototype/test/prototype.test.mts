import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import path from 'node:path'
import {afterEach, describe, it} from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'

import {runJson, ManagedProcess} from '../process.mts'
import {IosRuntime} from '../runtime.mts'
import type {RuntimeOptions, RuntimeDependencies} from '../runtime.mts'
import {createServer} from '../server.mts'
import {WdaClient} from '../wda.mts'

const token = 'test-token-that-is-long-enough-for-prototype'
const cleanups: Array<() => Promise<unknown>> = []
const options: RuntimeOptions = {
  udid: '00000000-0000000000000001', bundleId: 'test.wda.xctrunner'
, xctest: 'WebDriverAgentRunner.xctest', goIos: 'ios', iproxy: 'iproxy'
, imageMounter: 'go-ios', pymobiledevice3: '/venv/bin/pymobiledevice3'
, wdaPort: 18100, mjpegPort: 19100, tunnelPort: 28100, retryMs: 30, startupMs: 500
}

afterEach(async() => {
  for (const close of cleanups.splice(0).reverse()) {
    await close()
  }
})

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeAllConnections()
  }))
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for state')
    await delay(10)
  }
}

async function fixture() {
  const calls: Array<{method: string, path: string, body: any}> = []
  let failure = false
  let locked = false
  let protectedLock = false
  let lockReports = 0
  let lockPending = false
  let asleep = false
  const image = Buffer.from('89504e470d0a1a0a', 'hex')
  const origin = await listen(http.createServer(async(req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const input = Buffer.concat(chunks).toString()
    calls.push({method: req.method!, path: req.url!, body: input ? JSON.parse(input) : null})
    res.setHeader('Content-Type', 'application/json')
    if (failure) {
      res.writeHead(500)
      res.end(JSON.stringify({value: {error: 'invalid session id', message: 'Session is gone'}}))
    }
    else if (req.url?.endsWith('/wda/locked')) {
      if (lockPending && lockReports-- <= 0) {
        locked = true
        lockPending = false
      }
      res.end(JSON.stringify({value: locked}))
    }
    else if (req.url?.endsWith('/wda/performIoHidEvent')) {
      lockPending = true
      res.end(JSON.stringify({value: null}))
    }
    else if (req.url === '/wda/homescreen') {
      asleep = false
      if (!protectedLock) {
        locked = false
      }
      res.end(JSON.stringify({value: null}))
    }
    else if (req.url === '/wda/unlock') {
      if (protectedLock) {
        res.writeHead(500)
        res.end(JSON.stringify({value: {error: 'unknown error', message: 'Still locked'}}))
      }
      else {
        locked = false
        res.end(JSON.stringify({value: null}))
      }
    }
    else if (req.url === '/session' && req.method === 'POST') {
      res.end(JSON.stringify({value: {sessionId: 'owned-session'}}))
    }
    else if (req.url?.endsWith('/window/size')) {
      res.end(JSON.stringify({value: {width: 391, height: 845}}))
    }
    else if (req.url?.endsWith('/screenshot')) {
      res.end(JSON.stringify({value: image.toString('base64')}))
    }
    else {
      res.end(JSON.stringify({value: {ready: true}}))
    }
  }))
  const wda = new WdaClient(origin, 500)
  await wda.open()
  const runtime = new IosRuntime(options, {wda, log: () => null})
  runtime.state = 'ready'
  const api = await listen(createServer(runtime, token))
  const request = (route: string, value?: unknown, headers: Record<string, string> = {}) =>
    fetch(api + route, {
      method: typeof value === 'undefined' ? 'GET' : 'POST'
    , headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers}
    , ...(typeof value === 'undefined' ? {} : {body: JSON.stringify(value)})
    })
  return {runtime, calls, wda, api, request, image, asleep: () => asleep, sleep: () => {
    asleep = true
    locked = false
    runtime.telemetry.status.locked = false
  }, delayLock: (reports: number) => {
    lockReports = reports
  }, protect: () => {
    locked = true
    protectedLock = true
    runtime.telemetry.status.locked = true
  }, fail: () => {
    failure = true
  }}
}

describe('iOS prototype HTTP and WDA integration', () => {
  it('requires authentication and rejects cross-origin control', async() => {
    const f = await fixture()
    assert.equal((await fetch(f.api + '/device')).status, 401)
    assert.equal((await f.request('/home', {}, {Origin: 'https://example.com'})).status, 403)
    assert.equal(f.calls.length, 1)
    assert.equal((await f.request('/health')).status, 200)
  })

  it('reports not-ready without issuing device commands', async() => {
    const f = await fixture()
    f.runtime.state = 'waiting'
    assert.equal((await f.request('/tap', {x: 0.5, y: 0.5})).status, 503)
    assert.equal((await f.request('/device')).status, 200)
    assert.equal(f.calls.length, 1)
  })

  it('uses the device home-screen endpoint instead of a hardware Home button', async() => {
    const f = await fixture()
    assert.equal((await f.request('/home', {})).status, 200)
    assert.deepEqual(f.calls.slice(1), [
      {method: 'POST', path: '/wda/homescreen', body: {}}
    ])
    f.runtime.state = 'waiting'
    assert.equal((await f.request('/home', {})).status, 503)
    assert.equal(f.calls.length, 2)
  })

  it('keeps lock-screen input and screenshots available', async() => {
    const f = await fixture()
    f.delayLock(2)
    assert.deepEqual(await (await f.request('/lock', {})).json(), {locked: true})
    const power = f.calls.filter(call => call.path.endsWith('/wda/performIoHidEvent'))
    assert.equal(power.length, 1)
    assert.deepEqual(power[0]!.body, {page: 12, usage: 48, duration: 0.5})
    assert.deepEqual(await (await f.request('/lock', {})).json(), {locked: true})
    assert.equal(f.calls.filter(call => call.path.endsWith('/wda/performIoHidEvent')).length, 1)
    assert.equal(f.runtime.telemetry.status.locked, true)
    for (const [route, input] of [
      ['/tap', {x: 0.5, y: 0.5}], ['/swipe', {from: {x: 0.5, y: 0.9}, to: {x: 0.5, y: 0.2}}]
    , ['/text', {text: '123456'}], ['/home', {}]
    ] as const) {
      assert.equal((await f.request(route, input)).status, 200)
    }
    assert.equal((await f.request('/screenshot')).status, 200)
    assert.equal((await f.request('/apps/activate', {bundleId: 'test.app'})).status, 502)
    assert.deepEqual(await (await f.request('/unlock', {})).json(), {locked: false})
    assert.equal(f.runtime.telemetry.status.locked, false)
    f.protect()
    assert.deepEqual(await (await f.request('/unlock', {})).json(), {locked: true})
    assert.equal(f.runtime.telemetry.status.locked, true)
    f.fail()
    assert.equal((await f.request('/unlock', {})).status, 502)
  })

  it('wakes an asleep display even if the cached WDA lock flag is false', async() => {
    const f = await fixture()
    f.sleep()
    assert.deepEqual(await (await f.request('/unlock', {})).json(), {locked: false})
    assert.equal(f.asleep(), false)
  })

  it('targets power to one UDID and rejects commands after acceptance', async() => {
    const f = await fixture()
    for (const action of ['reboot', 'shutdown'] as const) {
      const calls: string[][] = []
      const runtime = new IosRuntime(options, {wda: f.wda, power: async(_binary, args) => {
        calls.push(args)
      }})
      runtime.state = 'ready'
      runtime.telemetry.status.locked = true
      const origin = await listen(createServer(runtime, token))
      const request = (action: string) => fetch(origin + '/power', {method: 'POST', headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'
      }, body: JSON.stringify({action})})
      assert.equal((await request('erase')).status, 400)
      assert.equal(calls.length, 0)
      assert.deepEqual(await (await request(action)).json(), {accepted: true})
      assert.deepEqual(calls, [[
        '--udid=' + options.udid, '--tunnel-info-port=' + options.tunnelPort, action
      ]])
      assert.equal(runtime.state, 'waiting')
      assert.equal(runtime.generation, 1)
      assert.equal((await request(action)).status, 503)
    }
    const runtime = new IosRuntime(options, {wda: f.wda, power: async() => {
      throw new Error('IOS_POWER_FAILED')
    }})
    runtime.state = 'ready'
    await assert.rejects(runtime.power('reboot'), /IOS_POWER_FAILED/)
    assert.equal(runtime.state, 'ready')
    assert.equal(runtime.generation, 0)
  })

  it('converts normalized coordinates to WDA points and preserves swipe duration', async() => {
    const f = await fixture()
    const response = await f.request('/swipe', {
      from: {x: 0.5, y: 1}, to: {x: 0, y: 0}, durationMs: 750
    })
    assert.equal(response.status, 200)
    const action = f.calls.find(call => call.path.endsWith('/actions'))!
    assert.equal(action.path, '/session/owned-session/actions')
    assert.deepEqual(action.body.actions[0].actions, [
      {type: 'pointerMove', duration: 0, origin: 'viewport', x: 195, y: 844}
    , {type: 'pointerDown', button: 0}
    , {type: 'pointerMove', duration: 750, origin: 'viewport', x: 0, y: 0}
    , {type: 'pointerUp', button: 0}
    ])
  })

  it('rejects malformed commands before sending anything to WDA', async() => {
    const f = await fixture()
    for (const input of [{x: -1, y: 0}, {x: '0.5', y: 0}, {x: 0, y: 2}]) {
      assert.equal((await f.request('/tap', input)).status, 400)
    }
    assert.equal((await f.request('/swipe', {from: {}, to: {x: 0, y: 0}})).status, 400)
    assert.equal((await f.request('/text', {text: 'x'.repeat(4097)})).status, 400)
    assert.equal((await f.request('/text', {text: 'x'.repeat(17000)})).status, 400)
    assert.equal((await f.request('/text', null)).status, 400)
    assert.equal(f.calls.length, 1)
  })

  it('sends text literally and returns screenshot bytes without JSON wrapping', async() => {
    const f = await fixture()
    const text = 'Привет "iPhone"; $(touch /tmp/unexpected)'
    assert.equal((await f.request('/text', {text})).status, 200)
    assert.deepEqual(f.calls.at(-1)!.body, {value: [text]})
    const response = await f.request('/screenshot')
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.image)
  })

  it('reports WDA failure and serializes commands across clients', async() => {
    const f = await fixture()
    const events: string[] = []
    await Promise.all([
      f.runtime.execute(async() => {
        events.push('start')
        await delay(20)
        events.push('end')
      })
    , f.runtime.execute(async() => {
        events.push('next')
      })
    ])
    assert.deepEqual(events, ['start', 'end', 'next'])
    f.fail()
    const response = await f.request('/home', {})
    assert.equal(response.status, 502)
    assert.equal((await response.json() as {error: string}).error, 'Session is gone')
  })

  it('drops commands queued before the runtime reconnects', async() => {
    const f = await fixture()
    let executed = false
    const pending = f.runtime.execute(async() => {
      executed = true
    })
    f.runtime.generation += 1
    await assert.rejects(pending, /not ready/)
    assert.equal(executed, false)
  })

  it('proxies MJPEG and closes the upstream when the viewer disconnects', async() => {
    const f = await fixture()
    let closed = false
    const upstream = await listen(http.createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=frame'})
      res.write('--frame\r\nContent-Type: image/jpeg\r\n\r\nframe-bytes\r\n')
      res.once('close', () => {
        closed = true
      })
    }))
    f.runtime.options.mjpegPort = Number(new URL(upstream).port)
    const response = await f.request('/screen')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /multipart/)
    const reader = response.body!.getReader()
    const chunk = await reader.read()
    assert.match(Buffer.from(chunk.value!).toString(), /frame-bytes/)
    await reader.cancel()
    await until(() => closed)
  })
})

describe('iOS prototype lifecycle', () => {
  function dependencies(f: Awaited<ReturnType<typeof fixture>>) {
    const spawned: Array<{
      binary: string, args: string[], stopped: boolean, failure: Error | null
    }> = []
    const commands: string[][] = []
    let connected = true
    const deps: RuntimeDependencies = {
      wda: f.wda
    , log: () => null
    , run: async() => ''
    , power: async() => {}
    , json: async(_binary, args) => {
        commands.push(args)
        if (args[0] === 'list') {
          return {deviceList: connected ? [options.udid] : []}
        }
        if (args.includes('ls')) {
          return [{udid: options.udid, address: 'fd00::1', rsdPort: 58783, userspaceTun: false}]
        }
        return {ProductVersion: '18.0'}
      }
    , start: (binary, args) => {
        const child = {binary, args, stopped: false, failure: null as Error | null
        , stop: async() => {
            child.stopped = true
          }}
        spawned.push(child)
        return child
      }
    }
    return {deps, spawned, commands, disconnect: () => {
      connected = false
    }}
  }

  it('selects one UDID, uses loopback forwards and cleans up only its own processes', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const runtime = new IosRuntime({...options}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.state === 'ready')
    assert.deepEqual(d.spawned[0]!.args, [
      '-u', options.udid, '-l', '-s', '127.0.0.1', '18100:8100', '19100:9100'
    ])
    assert.ok(d.commands.filter(args => args[0] !== 'list')
      .every(args => args.includes('--udid=' + options.udid)))
    await runtime.stop()
    assert.equal(runtime.state, 'stopped')
    assert.ok(d.spawned.every(child => child.stopped))
    assert.ok(f.calls.some(call => call.method === 'DELETE' &&
      call.path === '/session/owned-session'))
  })

  it('retries a missing phone without starting WDA on another connected device', async() => {
    const f = await fixture()
    const d = dependencies(f)
    d.disconnect()
    const runtime = new IosRuntime({...options}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.lastError?.includes('not connected') === true)
    assert.equal(d.spawned.length, 0)
    assert.equal(runtime.state, 'waiting')
  })

  it('restarts after a child dies and never presents the failed session as ready', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const runtime = new IosRuntime({...options}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.state === 'ready')
    const generation = runtime.generation
    d.spawned[1]!.failure = new Error('USB disconnected')
    await until(() => runtime.generation > generation)
    await until(() => runtime.state === 'ready')
    assert.ok(d.spawned.slice(0, 2).every(child => child.stopped))
    assert.equal(d.spawned.length, 4)
  })

  it('does not start a runner when the selected device has no tunnel', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const json = d.deps.json
    d.deps.json = (binary, args) => args.includes('ls') ?
      Promise.resolve([]) : json(binary, args)
    const runtime = new IosRuntime({...options}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.lastError?.includes('No go-ios tunnel') === true)
    assert.equal(d.spawned.length, 0)
  })

  it('stops a failed forward without launching WDA on an occupied port', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const start = d.deps.start
    d.deps.start = (binary, args) => {
      const child = start(binary, args)
      child.failure = new Error('address already in use')
      return child
    }
    const runtime = new IosRuntime({...options}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.lastError?.includes('address already in use') === true)
    await runtime.stop()
    assert.ok(d.spawned.length >= 1)
    assert.ok(d.spawned.every(child => child.binary === 'iproxy' && child.stopped))
  })

  it('mounts iOS 27 images through only the selected existing kernel tunnel', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const json = d.deps.json
    d.deps.json = (binary, args) => args.includes('ls') ? Promise.resolve([
      {udid: 'another-phone', address: 'fd00::2', rsdPort: 2222}
    , {udid: options.udid, address: 'fd00::1', rsdPort: 58783, userspaceTun: false}
    ]) : json(binary, args)
    const mounts: Array<{binary: string, args: string[]}> = []
    d.deps.run = async(binary, args) => {
      mounts.push({binary, args})
      return ''
    }
    const runtime = new IosRuntime({...options, imageMounter: 'pymobiledevice3'}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.state === 'ready')
    assert.deepEqual(mounts, [{binary: options.pymobiledevice3, args: [
      'mounter', 'auto-mount', '--udid=' + options.udid, '--rsd', 'fd00::1', '58783'
    ]}])
    assert.deepEqual(d.spawned.map(child => child.binary), ['iproxy', 'ios'])
  })

  it('rejects inaccessible or invalid RSD endpoints before mounting or starting WDA', async() => {
    for (const tunnel of [
      {address: 'fd00::1', rsdPort: 58783, userspaceTun: true}
    , {address: 'fd00::1', rsdPort: 0}
    , {address: 'fd00::1', rsdPort: '58783'}
    , {address: 'http://unexpected-host', rsdPort: 58783}
    , {}
    ]) {
      const f = await fixture()
      const d = dependencies(f)
      const json = d.deps.json
      d.deps.json = (binary, args) => args.includes('ls') ?
        Promise.resolve([{udid: options.udid, ...tunnel}]) : json(binary, args)
      let mounted = false
      d.deps.run = async() => {
        mounted = true
        return ''
      }
      const runtime = new IosRuntime({...options, imageMounter: 'pymobiledevice3'}, d.deps)
      cleanups.push(() => runtime.stop())
      runtime.start()
      await until(() => runtime.lastError !== null)
      await runtime.stop()
      assert.match(runtime.lastError!, /kernel go-ios tunnel|valid address\/rsdPort/)
      assert.equal(mounted, false)
      assert.equal(d.spawned.length, 0)
    }
  })

  it('does not fall back to another phone for developer-image mounting', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const json = d.deps.json
    d.deps.json = (binary, args) => args.includes('ls') ?
      Promise.resolve([{udid: 'another-phone', address: 'fd00::2', rsdPort: 1234}]) :
      json(binary, args)
    const runtime = new IosRuntime({...options, imageMounter: 'pymobiledevice3'}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.lastError?.includes('No go-ios tunnel') === true)
    assert.equal(d.spawned.length, 0)
  })

  it('keeps mounting failures visible without falling back or starting device control', async() => {
    const f = await fixture()
    const d = dependencies(f)
    const attempted: string[] = []
    d.deps.run = async binary => {
      attempted.push(binary)
      throw new Error('Cryptex personalization failed')
    }
    const runtime = new IosRuntime({...options, imageMounter: 'pymobiledevice3'}, d.deps)
    cleanups.push(() => runtime.stop())
    runtime.start()
    await until(() => runtime.lastError?.includes('Cryptex personalization failed') === true)
    await runtime.stop()
    assert.ok(attempted.length > 0)
    assert.ok(attempted.every(binary => binary === options.pymobiledevice3))
    assert.equal(d.spawned.length, 0)
  })

  it('cancels developer-image preparation on shutdown', async() => {
    for (const imageMounter of ['go-ios', 'pymobiledevice3'] as const) {
      const f = await fixture()
      const d = dependencies(f)
      let preparing = false
      d.deps.run = (_binary, _args, _timeout, signal) => new Promise((_resolve, reject) => {
        preparing = true
        signal!.addEventListener('abort', () => reject(new Error('aborted')), {once: true})
      })
      const runtime = new IosRuntime({...options, imageMounter}, d.deps)
      cleanups.push(() => runtime.stop())
      runtime.start()
      await until(() => preparing)
      await runtime.stop()
      assert.equal(runtime.state, 'stopped')
      assert.equal(d.spawned.length, 0)
    }
  })
})

describe('iOS prototype executable boundary', () => {
  it('passes arguments literally, rejects invalid JSON and bounds command execution', async() => {
    const literal = 'some-path; $(touch /tmp/never-execute)'
    const result = await runJson(process.execPath, [
      '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', literal
    ])
    assert.deepEqual(result, [literal])
    await assert.rejects(runJson(process.execPath, ['-e', 'process.stdout.write("invalid")']),
      /did not return JSON/)
    await assert.rejects(runJson(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 30))
  })

  it('reaps a long-running child on shutdown', async() => {
    const child = new ManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await child.stop()
    assert.ok(child.failure)
  })

  it('shows help without installed STF dependencies or Apple tooling', async() => {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [path.resolve(import.meta.dirname, '../main.mts'), '--help'],
        (error, stdout) => error ? reject(error) : resolve(stdout))
    })
    assert.match(output, /127.0.0.1/)
    assert.match(output, /--udid/)
  })

  it('reports missing tools with a failing doctor exit code', async() => {
    const result = await new Promise<{code: number, output: string}>(resolve => {
      execFile(process.execPath, [path.resolve(import.meta.dirname, '../main.mts')
        , '--doctor', '--go-ios', '/nonexistent/ios', '--iproxy', '/nonexistent/iproxy'
        , '--image-mounter', 'pymobiledevice3'
        , '--pymobiledevice3', '/nonexistent/pymobiledevice3'],
      (error, stdout) => resolve({code: Number(error?.code || 0), output: stdout}))
    })
    assert.equal(result.code, 1)
    const report = JSON.parse(result.output)
    assert.equal(report.passed, false)
    assert.equal(report.checks.find((c: {name: string}) => c.name === 'go-ios').passed, false)
    assert.equal(report.checks.find((c: {name: string}) =>
      c.name === 'pymobiledevice3').passed, false)
  })
})
