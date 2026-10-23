import assert from 'node:assert/strict'
import {execFile, spawnSync} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const available = spawnSync('docker', ['compose', 'version'], {stdio: 'ignore'}).status === 0

function run(binary: string, args: string[], env = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {cwd: repository, env, timeout: 15000}, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      }
      else {
        resolve(stdout)
      }
    })
  })
}

describe('iOS Compose CLI round trip', function() {
  this.timeout(30000)

  it('validates with Compose and preserves tokens across preparation', async function() {
    if (!available) {
      this.skip()
    }
    const directory = await fs.mkdtemp('/tmp/stf-ios-compose-')
    try {
      const state = path.join(directory, 'private-$literal')
      const args = ['tools/ios-prototype/compose.mts', 'prepare'
        , '--config', 'docker/ios/devices.example.json', '--state-dir', state
        , '--project', 'stf-ios-test']
      const env = {...process.env, STF_ADMIN_NAME: 'local $literal admin'}
      await run(process.execPath, args, env)
      const secret = await fs.readFile(path.join(state, 'session-secret'), 'utf8')
      const tokenName = (await fs.readdir(state)).find(name => name.endsWith('.token'))!
      const token = await fs.readFile(path.join(state, tokenName), 'utf8')
      await run(process.execPath, args, env)
      assert.equal(await fs.readFile(path.join(state, tokenName), 'utf8'), token)
      assert.equal(await fs.readFile(path.join(state, 'session-secret'), 'utf8'), secret)
      assert.equal((await fs.stat(state)).mode & 0o777, 0o700)
      assert.equal((await fs.stat(path.join(state, 'compose.json'))).mode & 0o777, 0o600)
      assert.equal((await fs.stat(path.join(state, 'session-secret'))).mode & 0o777, 0o600)
      const parsed = JSON.parse(await run('docker', ['compose', '--project-name', 'stf-ios-test'
        , '--file', path.join(state, 'compose.json'), 'config', '--format', 'json']))
      assert.equal(parsed.services.adb, undefined)
      assert.equal(parsed.services.provider, undefined)
      // Canonical Compose JSON escapes dollars for subsequent Compose loading.
      assert.equal(parsed.services.api.environment.STF_ADMIN_NAME, 'local $$literal admin')
      assert.equal(parsed.services.api.environment.SECRET, secret.trim())
      assert.equal(parsed.volumes['rethinkdb-data'].name, 'stf-ios-test_rethinkdb-data')
      assert.equal(parsed.networks.default.name, 'stf-ios-test_default')
      assert.equal(parsed.services.proxy.volumes[0].source,
        path.join(state, 'nginx.conf').replaceAll('$', () => '$$'))
    }
    finally {
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
