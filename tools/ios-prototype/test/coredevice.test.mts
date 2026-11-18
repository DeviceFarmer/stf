import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it} from 'node:test'

import {CoreDeviceSession} from '../coredevice.mts'

it('waits for the worker to dispatch input before accepting another touch', async() => {
  const dir = await mkdtemp(join(tmpdir(), 'stf-ios-worker-'))
  let acceptDispatch!: (response: http.ServerResponse) => void
  const dispatch = new Promise<http.ServerResponse>(resolve => {
    acceptDispatch = resolve
  })
  const server = http.createServer((request, response) => {
    switch (request.url) {
    case '/codec':
      response.end(JSON.stringify({codec: 'hev1.1.6.L120.B0', description: 'AAAB'}))
      break
    case '/stream.bin':
      response.writeHead(200, {'Content-Type': 'application/octet-stream'}).end(Buffer.from([1]))
      break
    case '/dispatch':
      acceptDispatch(response)
      break
    default:
      response.writeHead(404).end()
    }
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    await writeFile(join(dir, 'python3'), `#!/usr/bin/env node
const {createInterface} = require('node:readline')
const {get} = require('node:http')
const lines = createInterface({input: process.stdin})
;(async() => {
  let configured = false
  for await (const line of lines) {
    const input = JSON.parse(line)
    if (!configured) {
      configured = true
      console.log(${port})
      continue
    }
    if (input.type === 'contact' && input.x === 32768 && input.y === 16384) {
      await new Promise((resolve, reject) => {
        get('http://127.0.0.1:${port}/dispatch', response => {
          response.resume()
          response.once('end', resolve)
          response.once('error', reject)
        }).once('error', reject)
      })
      console.log('ok')
    }
    else {
      console.log('error')
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
`, {mode: 0o700})
    const signal = AbortSignal.timeout(30000)
    const session = new CoreDeviceSession(join(dir, 'pymobiledevice3'),
      'test-device', ['::1', '1234'], signal, () => {})
    try {
      const screen = await session.screen()
      await screen.body.cancel()
      const point = {x: 0.5, y: 0.25}
      const contact = session.touch('contact', point, signal)
      const [acknowledge] = await Promise.race([
        Promise.all([
          dispatch
        , assert.rejects(session.touch('release', point, signal), {status: 409})
        ])
      , contact.then(() => {
          throw new Error('Touch acknowledged before dispatch')
        })
      ])
      acknowledge.end()
      await contact
      await assert.rejects(session.touch('release', point, signal), /CoreDevice input was rejected/)
      assert.equal(session.signal.aborted, true)
    }
    finally {
      session.stop()
      server.closeAllConnections()
      await session.closed
    }
  }
  finally {
    server.close()
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
