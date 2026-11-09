import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const script = fileURLToPath(new URL('../../.github/scripts/docker-publish-manifest.sh',
  import.meta.url))
const image = 'example.invalid/stf'
const amd64 = 'a'.repeat(64)
const arm64 = 'b'.repeat(64)

function publish(artifacts: Record<string, string[]>) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-publish-manifest-'))
  try {
    for (var [arch, digests] of Object.entries(artifacts)) {
      var artifact = path.join(directory, 'digest-' + arch)
      fs.mkdirSync(artifact)
      for (var digest of digests) {
        fs.writeFileSync(path.join(artifact, digest), '')
      }
    }
    var log = path.join(directory, 'docker.log')
    fs.writeFileSync(log, '')
    fs.writeFileSync(path.join(directory, 'docker'),
      '#!/bin/sh\nprintf "%s\\n" "$@" >> "$DOCKER_LOG"\n', {mode: 0o700})

    var result = spawnSync('bash', [script, directory, image, 'latest'], {
      encoding: 'utf8'
    , timeout: 5000
    , env: {...process.env, PATH: directory + path.delimiter + process.env.PATH, DOCKER_LOG: log}
    })
    assert.ifError(result.error)
    return {status: result.status, stderr: result.stderr, log: fs.readFileSync(log, 'utf8')}
  }
  finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('Docker manifest publication', function() {
  it('publishes the tag using the verified digest for each architecture', function() {
    var result = publish({amd64: [amd64], arm64: [arm64]})
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.log, [
      'buildx', 'imagetools', 'create', '-t', `${image}:latest`
    , `${image}@sha256:${amd64}`, `${image}@sha256:${arm64}`
    , 'buildx', 'imagetools', 'inspect', `${image}:latest`
    , ''
    ].join('\n'))
  })

  for (const missing of ['amd64', 'arm64']) {
    it('keeps the tag untouched when the ' + missing + ' digest is missing', function() {
      var artifacts: Record<string, string[]> = {amd64: [amd64], arm64: [arm64]}
      delete artifacts[missing]
      var result = publish(artifacts)
      assert.equal(result.status, 1)
      assert.ok(result.stderr.includes('verified digest file for linux/' + missing))
      assert.equal(result.log, '')
    })
  }

  it('rejects an invalid digest before calling Docker', function() {
    var result = publish({amd64: [amd64], arm64: ['invalid']})
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid digest for linux\/arm64/)
    assert.equal(result.log, '')
  })

  it('rejects an artifact with multiple digest files', function() {
    var result = publish({amd64: [amd64, arm64], arm64: [arm64]})
    assert.equal(result.status, 1)
    assert.match(result.stderr, /one verified digest file for linux\/amd64/)
    assert.equal(result.log, '')
  })

  it('rejects duplicate architecture digests before calling Docker', function() {
    var result = publish({amd64: [amd64], arm64: [amd64]})
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Expected distinct digests/)
    assert.equal(result.log, '')
  })
})
