import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {runBlocks} from '../../.github/scripts/check-run-blocks.mts'

const amd64 = 'a'.repeat(64)
const arm64 = 'b'.repeat(64)
const image = 'example.invalid/stf'

function manifestScript() {
  var workflow = new URL('../../.github/workflows/docker-build.yml', import.meta.url)
  var step = runBlocks(fileURLToPath(workflow)).find(block =>
    block.job === 'manifest' && block.name === 'Create and push the manifest')
  assert.ok(step)
  return step.script
}

function publish(artifacts: Partial<Record<'amd64' | 'arm64', string[]>>) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-publish-manifest-'))
  try {
    for (var [arch, filenames] of Object.entries(artifacts)) {
      var artifact = path.join(directory, 'digests', 'digest-' + arch)
      fs.mkdirSync(artifact, {recursive: true})
      for (var filename of filenames) {
        fs.writeFileSync(path.join(artifact, filename), '')
      }
    }
    var stub = 'docker() {\n' +
      '  printf \'%s\\0\' "$#" "$@" >> "$RUNNER_TEMP/docker-arguments"\n' +
      '}\n'
    var result = spawnSync('bash', ['-c', stub + manifestScript()], {
      encoding: 'utf8'
    , timeout: 5000
    , env: {...process.env, RUNNER_TEMP: directory, IMAGE: image, TAG: 'latest'}
    })
    assert.ifError(result.error)
    var recorded = path.join(directory, 'docker-arguments')
    var calls: string[][] = []
    if (fs.existsSync(recorded)) {
      var args = fs.readFileSync(recorded, 'utf8').split('\0')
      assert.equal(args.pop(), '')
      while (args.length) {
        var count = Number(args.shift())
        assert.ok(Number.isInteger(count) && count > 0 && count <= args.length)
        calls.push(args.splice(0, count))
      }
    }
    return {result, calls}
  }
  finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('Docker manifest publication', function() {
  it('passes both architecture digests to Docker with exact arguments', function() {
    var {result, calls} = publish({amd64: [amd64], arm64: [arm64]})
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(calls, [
      ['buildx', 'imagetools', 'create', '-t', image + ':latest'
        , image + '@sha256:' + amd64, image + '@sha256:' + arm64]
    , ['buildx', 'imagetools', 'inspect', image + ':latest']
    ])
  })

  it('does not call Docker when an architecture digest is missing', function() {
    var {result, calls} = publish({amd64: [amd64]})
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Expected one verified digest file for linux\/arm64/)
    assert.deepEqual(calls, [])
  })

  it('does not call Docker when an architecture artifact is empty', function() {
    var {result, calls} = publish({amd64: [amd64], arm64: []})
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Expected one verified digest file for linux\/arm64/)
    assert.deepEqual(calls, [])
  })

  it('does not call Docker when an architecture artifact has multiple digest files', function() {
    var {result, calls} = publish({amd64: [amd64], arm64: [arm64, 'c'.repeat(64)]})
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Expected one verified digest file for linux\/arm64/)
    assert.deepEqual(calls, [])
  })

  it('does not call Docker when a digest filename contains the sha256 prefix', function() {
    var {result, calls} = publish({amd64: [amd64], arm64: ['sha256:' + arm64]})
    assert.equal(result.status, 1, result.stderr)
    assert.deepEqual(calls, [])
  })
})
