import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, it} from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {Installations} from '../installations.mts'
import {IosRuntime, type RuntimeOptions} from '../runtime.mts'
import {createServer} from '../server.mts'
import {runCommand} from '../process.mts'

const cleanups: Array<() => Promise<unknown>> = []
const manifest = {package: 'test.stf.app', name: 'Test App', version: '1.2'
  , minimumOSVersion: '18.0', profileExpiresAt: '2099-01-01T00:00:00Z'}

afterEach(async() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async() => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  return 'http://127.0.0.1:' + (server.address() as {port: number}).port
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Installation did not reach the expected state')
    await delay(10)
  }
}

async function fixture(options: {maxBytes?: number, storage?: http.RequestListener} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-ipa-test-'))
  cleanups.push(() => fs.rm(directory, {recursive: true, force: true}))
  const requests: string[] = []
  const storageUrl = await listen(http.createServer(options.storage || ((req, res) => {
    requests.push(req.url!)
    res.end(Buffer.from('test-ipa-bytes'))
  })))
  const runtime = new IosRuntime({udid: 'selected-phone', goIos: 'selected-ios'
    , bundleId: 'test.wda.xctrunner', tunnelPort: 28100} as RuntimeOptions)
  runtime.state = 'ready'
  runtime.info = {ProductVersion: '27.0.1'}
  const commands: string[][] = []
  let metadata: unknown = {manifest}
  let block = false
  let aborted = false
  let installedApps: unknown = [{CFBundleIdentifier: manifest.package
    , CFBundleShortVersionString: manifest.version}]
  const deps = {
    run: async(binary: string, args: string[], _timeout?: number, signal?: AbortSignal) => {
      commands.push([binary, ...args])
      if (block) {
        await new Promise<void>((_resolve, reject) => {
          signal!.addEventListener('abort', () => {
            aborted = true
            reject(signal!.reason)
          }, {once: true})
        })
      }
      return ''
    }
  , json: async(binary: string, args: string[]) => {
      commands.push([binary, ...args])
      return binary === 'python3' ? metadata : installedApps
    }
  }
  const manager = await Installations.create({storageUrl, directory
    , maxBytes: options.maxBytes || 1024}, runtime, deps)
  cleanups.push(() => manager.stop())
  const input = {id: randomUUID(), lease: randomUUID(), artifact: {id: randomUUID()
    , name: 'a'.repeat(32)}, launch: false, instance: runtime.instance, generation: 0}
  const done = async() => {
    await until(() => manager.status(input)!.settled)
    return manager.status(input)!
  }
  return {manager, runtime, input, directory, commands, requests, done
    , block: () => {
        block = true
      }, aborted: () => aborted
    , metadata: (value: unknown) => {
        metadata = value
      }
    , apps: (value: unknown) => {
        installedApps = value
      }}
}

describe('IPA installation jobs', () => {
  it('downloads only a blob and confirms the bundle on the selected UDID', async() => {
    const f = await fixture()
    await f.manager.start(f.input)
    const job = await f.done()
    assert.equal(job.state, 'installed')
    assert.deepEqual(job.manifest, manifest)
    assert.deepEqual(f.requests, ['/s/blob/' + f.input.artifact.id + '/' + 'a'.repeat(32)])
    assert.ok(f.commands.filter(args => args[0] === 'selected-ios')
      .every(args => args.includes('--udid=selected-phone')))
    assert.equal('lease' in job, false)
    assert.equal('artifact' in job, false)
    await f.manager.stop()
    assert.deepEqual(await fs.readdir(f.directory), [job.id + '.json'])
  })

  it('does not install unsigned packages or overwrite the WDA runner', async() => {
    for (const metadata of [{error: 'IOS_IPA_SIGNING'}
      , {manifest: {...manifest, package: 'test.wda.xctrunner'}}]) {
      const f = await fixture()
      f.metadata(metadata)
      await f.manager.start(f.input)
      assert.match((await f.done()).error!, /IOS_IPA_SIGNING|IOS_INSTALL_WDA_PROTECTED/)
      assert.equal(f.commands.some(args => args.includes('install')), false)
    }
  })

  it('deduplicates requests and rejects concurrent installations', async() => {
    const f = await fixture()
    f.block()
    const first = f.manager.start(f.input)
    await assert.rejects(f.manager.start({...f.input, id: randomUUID()}), /IOS_INSTALL_BUSY/)
    await first
    const duplicate = await f.manager.start(f.input)
    assert.equal(duplicate.id, f.input.id)
    await assert.rejects(f.manager.start({...f.input, launch: true}), /INVALID_REQUEST/)
    await until(() => f.commands.some(args => args.includes('install')))
    assert.equal(f.commands.filter(args => args.includes('install')).length, 1)
  })

  it('scopes status and cancellation to the device ownership lease', async() => {
    const f = await fixture()
    f.block()
    await f.manager.start(f.input)
    const foreign = {...f.input, lease: randomUUID()}
    assert.throws(() => f.manager.status(foreign), /NOT_FOUND/)
    await assert.rejects(f.manager.cancel(foreign), /NOT_FOUND/)
    assert.equal(f.manager.status({lease: foreign.lease}), null)
    await until(() => f.commands.some(args => args.includes('install')))
    assert.equal(f.aborted(), false)
    const canceled = await f.manager.cancel(f.input)
    assert.equal(canceled!.state, 'canceled')
    assert.equal(canceled!.outcomeUncertain, true)
    assert.equal(f.aborted(), true)
  })

  it('aborts when USB recovery changes the device generation', async() => {
    const f = await fixture()
    f.block()
    await f.manager.start(f.input)
    await until(() => f.commands.some(args => args.includes('install')))
    f.runtime.generation++
    const job = await f.done()
    assert.equal(job.error, 'IOS_INSTALL_INTERRUPTED')
    assert.equal(f.aborted(), true)
  })

  it('does not report success if installation cannot be verified', async() => {
    const f = await fixture()
    f.apps([])
    await f.manager.start(f.input)
    const job = await f.done()
    assert.equal(job.error, 'IOS_INSTALL_VERIFY_FAILED')
    assert.equal(job.outcomeUncertain, true)
  })

  it('opens a verified app and reports launch failures separately', async() => {
    for (const fail of [false, true]) {
      const f = await fixture()
      f.input.launch = true
      let activated = false
      f.runtime.wda.call = async(method, route, body) => {
        if (method === 'GET') {
          assert.equal(route, '/wda/activeAppInfo')
          return {value: {bundleId: manifest.package}}
        }
        assert.equal(method, 'POST')
        assert.equal(route, '/wda/apps/activate')
        assert.deepEqual(body, {bundleId: manifest.package})
        activated = true
        if (fail) {
          throw new Error('App could not be opened')
        }
        return {value: null}
      }
      await f.manager.start(f.input)
      const job = await f.done()
      assert.equal(activated, true)
      assert.equal(job.state, 'installed')
      assert.equal(job.launchError, fail)
    }
  })

  it('reports an app that crashes immediately as installed with a launch warning', async() => {
    const f = await fixture()
    f.input.launch = true
    f.runtime.wda.call = async() => ({value: {bundleId: 'com.apple.springboard'}})
    await f.manager.start(f.input)
    const job = await f.done()
    assert.equal(job.state, 'installed')
    assert.equal(job.launchError, true)
  })

  it('interrupts an installation when bridge heartbeats stop', async() => {
    const f = await fixture()
    f.block()
    await f.manager.start(f.input)
    await until(() => f.commands.some(args => args.includes('install')))
    const now = Date.now
    try {
      const future = now() + 11000
      Date.now = () => future
      await delay(350)
    }
    finally {
      Date.now = now
    }
    assert.equal((await f.done()).error, 'IOS_INSTALL_INTERRUPTED')
    assert.equal(f.aborted(), true)
  })

  it('limits known and streamed downloads and rejects redirects', async() => {
    for (const storage of [
      ((_req, res) => res.end('123456789')) as http.RequestListener
    , ((_req, res) => {
        res.write('12345')
        res.end('67890')
      }) as http.RequestListener
    , ((_req, res) => {
        res.writeHead(302, {Location: 'http://127.0.0.1:1/private'})
        res.end()
      }) as http.RequestListener
    ]) {
      const f = await fixture({maxBytes: 8, storage})
      await f.manager.start(f.input)
      assert.equal((await f.done()).state, 'failed')
      assert.equal(f.commands.length, 0)
    }
  })

  it('rejects malformed artifact identifiers and a stale runtime before downloading', async() => {
    const f = await fixture()
    await assert.rejects(f.manager.start({...f.input, artifact: {id: '../secret', name: 'x'}}),
      /INVALID_REQUEST/)
    await assert.rejects(f.manager.start({...f.input, instance: randomUUID()}), /INTERRUPTED/)
    assert.equal(f.requests.length, 0)
  })

  it('records interrupted jobs after restart without reinstalling', async() => {
    const f = await fixture()
    await fs.writeFile(path.join(f.directory, f.input.id + '.json'), JSON.stringify({
      ...f.input, state: 'installing_app', settled: false, updatedAt: Date.now()
    }))
    await fs.mkdir(path.join(f.directory, 'ipa-orphan'))
    const recovered = await Installations.create(f.manager.options, f.runtime)
    cleanups.push(() => recovered.stop())
    const job = recovered.status(f.input)!
    assert.equal(job.error, 'IOS_INSTALL_INTERRUPTED')
    assert.equal(job.outcomeUncertain, true)
    assert.equal(f.requests.length, 0)
    assert.equal((await fs.readdir(f.directory)).includes('ipa-orphan'), false)
  })

  it('authenticates jobs and allows status while WDA is unavailable', async() => {
    const f = await fixture()
    const url = await listen(createServer(f.runtime, 'a'.repeat(32), f.manager))
    assert.equal((await fetch(url + '/installations/start', {method: 'POST'})).status, 401)
    f.runtime.state = 'waiting'
    const response = await fetch(url + '/installations/status', {method: 'POST'
      , headers: {Authorization: 'Bearer ' + 'a'.repeat(32), 'Content-Type': 'application/json'}
      , body: JSON.stringify({lease: f.input.lease})})
    assert.equal(response.status, 200)
    assert.equal(await response.json(), null)
  })

  it('checks real IPA ZIP/plist/Mach-O/CMS fixtures with the Python preflight', async() => {
    const output = await runCommand('python3', [
      path.join(import.meta.dirname, 'ipa_metadata_test.py')
    ], 30000)
    assert.match(output, /IPA preflight fixtures passed/)
  })
})
