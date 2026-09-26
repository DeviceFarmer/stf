import assert from 'node:assert'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function runLeg(states: string[]) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-sim-readiness-'))
  var bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(directory, 'states'), states.join('\n') + '\n')
  fs.writeFileSync(path.join(directory, 'current'), '')
  fs.writeFileSync(path.join(directory, 'count'), '0')
  var scripts: Record<string, string> = {
    adb: [
      'case "$*" in'
    , '  *"shell getprop gsm.sim.state")'
    , '    count=$(cat "$SIM_TEST_DIR/count")'
    , '    count=$((count + 1))'
    , '    printf "%s" "$count" > "$SIM_TEST_DIR/count"'
    , '    state=$(sed -n "${count}p" "$SIM_TEST_DIR/states")'
    , '    [ -n "$state" ] || state=$(tail -1 "$SIM_TEST_DIR/states")'
    , '    printf "sim:%s\\n" "$state" >> "$SIM_TEST_DIR/events"'
    , '    if [ "$state" = FAIL ]; then'
    , '      echo "getprop failed: device offline" >&2'
    , '      exit 1'
    , '    fi'
    , '    printf "%s\\n" "$state" > "$SIM_TEST_DIR/current"'
    , '    printf "%s\\n" "$state"'
    , '    ;;'
    , '  *"shell getprop sys.boot_completed") echo 1 ;;'
    , '  *"shell getprop ro.build.version.sdk") echo 34 ;;'
    , '  *"shell getprop ro.product.cpu.abi") echo x86_64 ;;'
    , '  *"shell echo adb-ok") echo adb-ok ;;'
    , '  *"shell id") echo "uid=0(root) gid=0(root)" ;;'
    , 'esac'
    ].join('\n')
  , bash: [
      'if [ "$1" = .github/scripts/start-stf.sh ]; then'
    , '  cp "$SIM_TEST_DIR/current" "$SIM_TEST_DIR/registered"'
    , '  echo start >> "$SIM_TEST_DIR/events"'
    , '  exit 0'
    , 'fi'
    , 'exec /bin/bash "$@"'
    ].join('\n')
  , node: [
      'case "${1:-}:${2:-}" in'
    , '  .github/scripts/stf-devices.mts:subscriber)'
    , '    echo subscriber >> "$SIM_TEST_DIR/events"'
    , '    state=$(cat "$SIM_TEST_DIR/registered")'
    , '    case ",$state," in'
    , '      *,READY,* | *,LOADED,*) exit 0 ;;'
    , '      *) exit 1 ;;'
    , '    esac'
    , '    ;;'
    , '  .github/scripts/stf-devices.mts:*) exit 0 ;;'
    , '  .github/scripts/playwright-checks.mts:*) exit 0 ;;'
    , '  .github/scripts/merge-checks.mts:*) exit 0 ;;'
    , 'esac'
    , 'exec "$SIM_TEST_NODE" "$@"'
    ].join('\n')
  , sleep: 'exit 0'
  , npx: 'exit 0'
  }
  try {
    Object.keys(scripts).forEach(function(name) {
      fs.writeFileSync(path.join(bin, name), scripts[name] + '\n', {mode: 0o755})
    })
    var checks = path.join(directory, 'checks.json')
    var result = childProcess.spawnSync('/bin/bash', ['.github/scripts/android-leg.sh'], {
      cwd: path.resolve(import.meta.dirname, '../..')
    , env: Object.assign({}, process.env, {
        PATH: bin + path.delimiter + process.env.PATH
      , SIM_TEST_DIR: directory
      , SIM_TEST_NODE: process.execPath
      , STF_DEVICE_SERIAL: 'sim-test'
      , STF_LOG_DIR: path.join(directory, 'logs')
      , CHECKS_FILE: checks
      })
    , encoding: 'utf8'
    , timeout: 8000
    })
    assert.equal(result.status, 0, result.stderr)
    return {
      checks: JSON.parse(fs.readFileSync(checks, 'utf8'))
    , events: fs.readFileSync(path.join(directory, 'events'), 'utf8').trim().split('\n')
    , stderr: result.stderr
    }
  }
  finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('Android leg SIM readiness', function() {
  this.timeout(10000)

  it('should wait for a delayed SIM before STF captures the device identity', function() {
    var run = runLeg(['NOT_READY', 'LOADED'])
    assert.equal(run.checks.subscriber_properties, 'pass')
    assert.deepEqual(run.events, ['sim:NOT_READY', 'sim:LOADED', 'start', 'subscriber'])
  })

  ;['READY', 'ABSENT,READY', 'NOT_READY,LOADED'].forEach(function(state) {
    it('should recognize a usable SIM before registration in state ' + state, function() {
      var run = runLeg([state])
      assert.equal(run.checks.subscriber_properties, 'pass')
      assert.deepEqual(run.events, ['sim:' + state, 'start', 'subscriber'])
    })
  })

  it('should not require subscriber fields when the SIM remains absent', function() {
    var run = runLeg(['ABSENT'])
    assert.equal(run.checks.subscriber_properties, 'pass')
    assert.equal(run.events.indexOf('subscriber'), -1)
    assert.equal(run.events[0], 'sim:ABSENT')
    assert.equal(run.events[run.events.length - 1], 'start')
  })

  it('should fail SIM validation when ADB cannot read the SIM state', function() {
    var run = runLeg(['FAIL'])
    assert.equal(run.checks.subscriber_properties, 'fail')
    assert.equal(run.events.indexOf('subscriber'), -1)
    assert.match(run.stderr, /getprop failed: device offline/)
  })

  it('should not reuse an earlier SIM read after ADB stops responding', function() {
    var run = runLeg(['ABSENT', 'FAIL'])
    assert.equal(run.checks.subscriber_properties, 'fail')
  })
})
