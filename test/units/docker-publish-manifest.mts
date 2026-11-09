import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {runBlocks} from '../../.github/scripts/check-run-blocks.mts'

describe('Docker manifest publication', function() {
  it('does not call Docker when an architecture digest is missing', function() {
    var workflow = new URL('../../.github/workflows/docker-build.yml', import.meta.url)
    var step = runBlocks(fileURLToPath(workflow)).find(block =>
      block.job === 'manifest' && block.name === 'Create and push the manifest')
    assert.ok(step)

    var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-publish-manifest-'))
    try {
      var artifact = path.join(directory, 'digests', 'digest-amd64')
      fs.mkdirSync(artifact, {recursive: true})
      fs.writeFileSync(path.join(artifact, 'a'.repeat(64)), '')

      var stub = 'docker() { : > "$RUNNER_TEMP/docker-called"; }\n'
      var result = spawnSync('bash', ['-c', stub + step.script], {
        encoding: 'utf8'
      , timeout: 5000
      , env: {...process.env, RUNNER_TEMP: directory, IMAGE: 'example.invalid/stf', TAG: 'latest'}
      })
      assert.ifError(result.error)
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /Expected one verified digest file for linux\/arm64/)
      assert.equal(fs.existsSync(path.join(directory, 'docker-called')), false)
    }
    finally {
      fs.rmSync(directory, {recursive: true, force: true})
    }
  })
})
