import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it} from 'node:test'

import {CoreDeviceSession} from '../coredevice.mts'

it('waits for the worker to dispatch input before accepting another touch', async() => {
  const dir = await mkdtemp(join(tmpdir(), 'stf-ios-worker-'))
  try {
    await writeFile(join(dir, 'python3'), `#!/usr/bin/env node
const {createInterface} = require('node:readline')
const {writeFileSync} = require('node:fs')
const {join} = require('node:path')
const {setTimeout} = require('node:timers/promises')
const lines = createInterface({input: process.stdin})
;(async() => {
  let configured = false
  for await (const line of lines) {
    const input = JSON.parse(line)
    if (!configured) {
      configured = true
      console.log('10000')
      continue
    }
    if (input.type === 'contact' && input.x === 32768 && input.y === 16384) {
      await setTimeout(120)
      writeFileSync(join(__dirname, 'dispatched'), 'contact')
      console.log('ok')
    }
    else {
      console.log('error')
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
`, {mode: 0o700})
    const signal = AbortSignal.timeout(5000)
    const session = new CoreDeviceSession(join(dir, 'pymobiledevice3'),
      'test-device', ['::1', '1234'], signal, () => {})
    try {
      const point = {x: 0.5, y: 0.25}
      const contact = session.touch('contact', point, signal)
      await assert.rejects(session.touch('release', point, signal), {status: 409})
      await contact
      assert.equal(await readFile(join(dir, 'dispatched'), 'utf8'), 'contact')
      await assert.rejects(session.touch('release', point, signal), /CoreDevice input was rejected/)
      assert.equal(session.signal.aborted, true)
    }
    finally {
      session.stop()
      await session.closed
    }
  }
  finally {
    await rm(dir, {recursive: true, force: true})
  }
})

it('continues streaming after a failed keyframe request', async() => {
  const video: {response?: http.ServerResponse} = {}
  const server = http.createServer((req, res) => {
    if (req.url === '/codec') {
      res.end(JSON.stringify({codec: 'hev1.1.6.L120.B0', description: 'AAAB'}))
    }
    else if (req.url === '/stream.bin') {
      video.response = res
      res.writeHead(200, {'Content-Type': 'application/octet-stream'})
      res.write(Buffer.from([1]))
    }
    else {
      assert.equal(req.url, '/pli')
      res.writeHead(503).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = await mkdtemp(join(tmpdir(), 'stf-ios-worker-'))
  try {
    const port = (server.address() as AddressInfo).port
    await writeFile(join(dir, 'python3'), `#!/usr/bin/env node
process.stdin.resume()
console.log(${port})
`, {mode: 0o700})
    const signal = AbortSignal.timeout(5000)
    const session = new CoreDeviceSession(join(dir, 'pymobiledevice3'),
      'test-device', ['::1', '1234'], signal, () => {})
    try {
      const reader = (await session.screen()).body.getReader()
      assert.deepEqual((await reader.read()).value, Uint8Array.of(1))
      await assert.rejects(session.keyframe(signal), /CoreDevice keyframe request was rejected/)
      assert.equal(session.signal.aborted, false)
      assert.ok(video.response)
      video.response.end(Buffer.from([2]))
      assert.deepEqual((await reader.read()).value, Uint8Array.of(2))
      assert.equal((await reader.read()).done, true)
    }
    finally {
      session.stop()
      await session.closed
    }
  }
  finally {
    server.close()
    server.closeAllConnections()
    await rm(dir, {recursive: true, force: true})
  }
})
