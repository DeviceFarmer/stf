import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
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
      await session.stop()
    }
  }
  finally {
    await rm(dir, {recursive: true, force: true})
  }
})
