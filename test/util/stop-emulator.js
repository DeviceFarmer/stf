var assert = require('assert')
var childProcess = require('child_process')
var fs = require('fs')
var os = require('os')
var path = require('path')
var sinon = require('sinon')
var stopEmulator = require('../../.github/scripts/stop-emulator')

describe('CI emulator cleanup', function() {
  var sandbox, ps, adb, kill, running

  beforeEach(function() {
    sandbox = sinon.createSandbox()
    running = [
      '100 S /sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 -port 5554 -avd test'
    , '200 S /sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 -port 5556 -avd other'
    , '300 S adb -s emulator-5554 logcat'
    , '400 Z /sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 -port 5554 -avd test'
    , '500 S node script.js qemu-system-x86_64 -port 5554'
    ]
    ps = sandbox.stub(childProcess, 'execFileSync').callsFake(function(command) {
      return command === 'ps' ? running.join('\n') : ''
    })
    adb = sandbox.stub(childProcess, 'spawnSync').returns({status: 0})
    kill = sandbox.stub(process, 'kill').callsFake(function(pid) {
      running = running.filter(function(line) {
        return !line.startsWith(pid + ' ')
      })
    })
    sandbox.stub(process.stdout, 'write')
  })

  afterEach(function() {
    sandbox.restore()
  })

  it('allows a graceful shutdown without sending signals', function() {
    adb.callsFake(function() {
      running.shift()
      return {status: 0}
    })
    stopEmulator('5554')
    sinon.assert.notCalled(kill)
    sinon.assert.calledWith(adb, 'adb', ['-s', 'emulator-5554', 'emu', 'kill'], {
      stdio: 'inherit', timeout: 10000, killSignal: 'SIGKILL'
    })
  })

  it('terminates only the selected emulator when adb reports OK but it stays alive', function() {
    stopEmulator('5554')
    sinon.assert.calledOnceWithExactly(kill, 100, 'SIGTERM')
    assert.strictEqual(ps.getCalls().filter(function(call) {
      return call.args[0] === 'sleep'
    }).length, 10)
  })

  it('kills an emulator that ignores SIGTERM after adb times out', function() {
    adb.returns({error: {code: 'ETIMEDOUT'}, signal: 'SIGKILL'})
    kill.onFirstCall().returns(true)
    stopEmulator('5554')
    sinon.assert.calledWithExactly(kill, 100, 'SIGTERM')
    sinon.assert.calledWithExactly(kill, 100, 'SIGKILL')
    assert.strictEqual(kill.callCount, 2)
  })

  it('fails if the emulator survives SIGKILL', function() {
    kill.returns(true)
    assert.throws(function() {
      stopEmulator('5554')
    }, /still running after SIGKILL/)
  })

  it('tolerates the emulator exiting between the process lookup and signal', function() {
    kill.callsFake(function() {
      running.shift()
      var error = new Error('No such process')
      error.code = 'ESRCH'
      throw error
    })
    stopEmulator('5554')
    sinon.assert.calledOnce(kill)
  })

  it('rejects an invalid port before running commands', function() {
    assert.throws(function() {
      stopEmulator('5554 other')
    }, /Invalid emulator port/)
    sinon.assert.notCalled(adb)
    sinon.assert.notCalled(ps)
  })
})

describe('CI emulator cleanup wrapper', function() {
  var directory
  var wrapper = path.resolve(__dirname, '../../.github/scripts/with-emulator-cleanup.sh')

  beforeEach(function() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-emulator-cleanup-'))
    fs.mkdirSync(path.join(directory, '.github/scripts'), {recursive: true})
    fs.writeFileSync(path.join(directory, '.github/scripts/stop-emulator.js'),
      'process.stdout.write("cleanup ran\\n"); process.exit(Number(process.env.CLEANUP_STATUS))')
  })

  afterEach(function() {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  ;[
    {test: 0, cleanup: 0, expected: 0}
  , {test: 42, cleanup: 0, expected: 42}
  , {test: 0, cleanup: 1, expected: 1}
  , {test: 42, cleanup: 1, expected: 42}
  ].forEach(function(result) {
    var title = 'preserves test status ' + result.test + ' with cleanup status ' + result.cleanup
    it(title, function() {
      var run = childProcess.spawnSync('bash', [wrapper, '-c', 'exit ' + result.test], {
        cwd: directory
      , encoding: 'utf8'
      , timeout: 5000
      , env: Object.assign({}, process.env, {CLEANUP_STATUS: String(result.cleanup)})
      })
      assert.strictEqual(run.status, result.expected)
      assert.strictEqual(run.stdout, 'cleanup ran\n')
    })
  })
})
