import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import yargs from 'yargs'
import {builder, command, describe as description} from '../../lib/cli/coordinator/index.js'
import {validateOptions} from '../../lib/units/coordinator/config.js'

const required = [
  '--stf-api-url', 'http://stf.example.test/api/v1'
, '--stf-token-file', '/secrets/stf-token'
, '--api-token-file', '/secrets/api-token'
, '--state-file', '/state/coordinator.json'
, '--adb-pools-file', '/config/adb-pools.json'
]

const parse = (args: string[]) => builder(yargs(args).exitProcess(false))
  .fail((message, error) => {
    throw error || new Error(message)
  })
  .parseSync()

describe('coordinator CLI', () => {
  it('provides an independently runnable service with file-based credentials', () => {
    assert.equal(command, 'coordinator')
    assert.match(description, /Appium/)
    const argv = parse(required)
    assert.equal(argv.host, '127.0.0.1')
    assert.equal(argv.port, 8080)
    assert.equal(argv.publicUrl, 'http://127.0.0.1:8080')
    assert.equal(argv.leaseTtlSeconds, 180)
    assert.equal(argv.heartbeatIntervalSeconds, 30)
    assert.equal(argv.pollIntervalSeconds, 1)
    assert.equal(argv.maxDurationSeconds, 21600)
    assert.equal(argv.maxParallel, 10)
    assert.equal(argv.upstreamTimeoutSeconds, 30)
    assert.equal(argv.stfTokenFile, '/secrets/stf-token')
    assert.equal(argv.apiTokenFile, '/secrets/api-token')
    assert.equal(typeof argv.appiumGridUrl, 'undefined')
  })

  it('allows Maestro-only Android pools alongside optional Appium Grid', async() => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stf-coordinator-options-'))
    try {
      const pools = [{provider: 'android', host: 'adb', port: 5037, systemPorts: []}]
      const {appiumGridUrl, projectTokensFile, ...argv} = parse(required)
      assert.equal(appiumGridUrl, undefined)
      assert.equal(projectTokensFile, undefined)
      const config = {...argv, stateFile: path.join(directory, 'state.json')
        , adbPoolsFile: path.join(directory, 'pools.json')}
      await writeFile(config.adbPoolsFile, JSON.stringify(pools))
      assert.deepEqual(await validateOptions(config), pools)
      assert.deepEqual(await validateOptions({...config, appiumGridUrl: 'http://grid.example.test'}),
        pools)
      await assert.rejects(validateOptions({...config, appiumGridUrl: ''}), /Invalid URL/)
    }
    finally {
      await rm(directory, {recursive: true, force: true})
    }
  })

  it('reads namespaced environment settings and lets explicit flags override them', () => {
    // yargs-parser captures the environment when it loads.
    const cli = new URL('../../lib/cli/coordinator/index.js', import.meta.url).href
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import yargs from 'yargs'
      import {builder} from ${JSON.stringify(cli)}
      const required = ${JSON.stringify(required)}
      const parse = args => builder(yargs(args).exitProcess(false)).parseSync()
      const fromEnv = parse(required).maxParallel
      const fromFlag = parse([...required, '--max-parallel', '2']).maxParallel
      console.log(JSON.stringify([fromEnv, fromFlag]))
    `], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000
    , env: {...process.env, STF_COORDINATOR_MAX_PARALLEL: '3'}
    })
    assert.deepEqual(JSON.parse(output), [3, 2])
  })

  it('rejects missing durable configuration and accidental plaintext token flags', () => {
    const withoutState = required.filter(value =>
      !['--state-file', '/state/coordinator.json'].includes(value))
    assert.throws(() => parse(withoutState), /state-file/)
    for (const flag of ['--api-token', '--stf-token']) {
      assert.throws(() => parse([...required, flag, 'not-supported']), /Unknown argument/)
    }
  })

  it('rejects settings that cannot sustain a renewable lease', () => {
    for (const [option, value] of [
      ['--port', '65536'], ['--max-parallel', '0'], ['--poll-interval-seconds', '1.5']
    , ['--lease-ttl-seconds', '30'], ['--heartbeat-interval-seconds', '180']
    ]) {
      assert.throws(() => parse([...required, option!, value!]))
    }
  })

  it('documents the service flags without starting an upstream connection', () => {
    const output = builder(yargs([]).exitProcess(false)).help().getHelp()
    return Promise.resolve(output).then(help => {
      assert.match(help, /--state-file/)
      assert.match(help, /--api-token-file/)
      assert.match(help, /STF_COORDINATOR_/)
      assert.match(help, /exactly one coordinator/)
    })
  })
})
