import assert from 'node:assert/strict'
import {spawn, type ChildProcess} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import {afterEach, describe, it} from 'node:test'
import {probeSocket, supervise} from '../container.mts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function fixture() {
  const directory = await fs.mkdtemp('/tmp/stf-ios-socket-')
  cleanups.push(() => fs.rm(directory, {recursive: true, force: true}))
  const socketPath = path.join(directory, 'usbmuxd')
  const daemon = spawn(process.execPath, ['-e'
    , 'require("net").createServer(s=>s.on("error",()=>{}))' +
      '.listen(process.argv[1],()=>process.send("ready"))', socketPath]
  , {stdio: ['ignore', 'ignore', 'inherit', 'ipc']})
  cleanups.push(() => stop(daemon))
  await once(daemon, 'message')
  return {socketPath, daemon}
}

async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'close')
  }
}

describe('standalone iOS process supervision', () => {
  it('exits on a stale mounted socket so Docker can remount its replacement', async() => {
    const {socketPath, daemon} = await fixture()
    assert.equal(await probeSocket(socketPath), true)
    const abort = new AbortController()
    const supervised = supervise([process.execPath, '-e', 'setInterval(()=>{},1000)']
      , {socketPath, intervalMs: 20, failures: 2, signal: abort.signal})
    cleanups.push(async() => {
      abort.abort()
      await supervised
    })
    await stop(daemon)
    assert.equal((await fs.stat(socketPath)).isSocket(), true)
    assert.equal(await probeSocket(socketPath), false)
    assert.equal(await supervised, 1)
  })

  for (const mode of ['parent', 'native-tunnel']) {
    it(mode + ' stops its child when the parent closes the lifetime pipe', async() => {
    const {socketPath} = await fixture()
    const helper = new URL('../container.mts', import.meta.url)
    const wrapper = spawn(process.execPath, [helper.pathname, mode, process.execPath, '-e'
      , 'process.stdout.write(String(process.pid)+"\\n");setInterval(()=>{},1000)']
    , {stdio: ['pipe', 'pipe', 'inherit']
      , env: {...process.env, STF_IOS_USBMUXD_SOCKET: socketPath}})
    cleanups.push(() => stop(wrapper))
    const [data] = await once(wrapper.stdout!, 'data')
    const pid = Number(data.toString().trim())
    assert.ok(Number.isInteger(pid) && pid > 0)
    const closed = once(wrapper, 'close')
    wrapper.stdin!.end()
    const [code] = await closed
    assert.equal(code, 0)
    assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'})
    })
  }
})
