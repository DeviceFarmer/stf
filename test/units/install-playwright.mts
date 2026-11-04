import assert from 'node:assert'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface RunOptions {
  cachedDeps?: boolean
  launchFailsOnce?: boolean
  dryRunOutput?: string
}

function runInstallPlaywright(options: RunOptions) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-install-pw-'))
  var bin = path.join(directory, 'bin')
  var pwDir = path.join(directory, 'playwright')
  fs.mkdirSync(bin)
  fs.mkdirSync(pwDir)
  fs.writeFileSync(path.join(directory, 'events'), '')
  fs.writeFileSync(path.join(directory, 'launches'), '0')

  function writeFakePlaywrightModule() {
    var modDir = path.join(pwDir, 'node_modules', '@playwright', 'test')
    fs.mkdirSync(modDir, {recursive: true})
    fs.writeFileSync(path.join(modDir, 'index.js'), [
      'var fs = require("fs")'
    , 'var path = require("path")'
    , 'var countFile = path.join(process.env.PW_TEST_DIR, "launches")'
    , 'var eventsFile = path.join(process.env.PW_TEST_DIR, "events")'
    , 'exports.chromium = {'
    , '  launch: function() {'
    , '    var n = Number(fs.readFileSync(countFile, "utf8")) + 1'
    , '    fs.writeFileSync(countFile, String(n))'
    , '    fs.appendFileSync(eventsFile, "launch:" + n + "\\n")'
    , '    if (process.env.PW_FAIL_FIRST_LAUNCH === "1" && n === 1) {'
    , '      return Promise.reject(new Error("error while loading shared libraries: libnss3.so"))'
    , '    }'
    , '    return Promise.resolve({close: function() { return Promise.resolve() }})'
    , '  }'
    , '}'
    ].join('\n') + '\n')
  }

  if (options.cachedDeps) {
    writeFakePlaywrightModule()
  }

  var scripts: Record<string, string> = {
    npm: [
      'printf "npm:%s\\n" "$*" >> "$PW_TEST_DIR/events"'
    , 'mkdir -p "$PW_MOD_DIR"'
    , 'cp "$PW_TEST_DIR/module-template.js" "$PW_MOD_DIR/index.js"'
    ].join('\n')
  , npx: [
      'printf "npx:%s\\n" "$*" >> "$PW_TEST_DIR/events"'
    , 'case "$*" in'
    , '  "playwright install-deps --dry-run chromium")'
    , '    cat "$PW_TEST_DIR/dry-run.txt"'
    , '    exit 0'
    , '    ;;'
    , 'esac'
    , 'exit 0'
    ].join('\n')
  , dpkg_or_apt_bash: ''
  }

  // Provide a template so simulated `npm install` creates @playwright/test.
  var tmpTemplateDir = path.join(directory, 'tmpl')
  fs.mkdirSync(tmpTemplateDir)
  writeFakePlaywrightModule()
  fs.copyFileSync(
    path.join(pwDir, 'node_modules', '@playwright', 'test', 'index.js')
  , path.join(directory, 'module-template.js')
  )
  if (!options.cachedDeps) {
    fs.rmSync(path.join(pwDir, 'node_modules'), {recursive: true, force: true})
  }

  fs.writeFileSync(
    path.join(directory, 'dry-run.txt')
  , options.dryRunOutput || ''
  )

  // Wrap bash only when apt-install.sh is invoked; delegate everything else.
  scripts.bash = [
    'case "${1:-}" in'
  , '  */apt-install.sh)'
  , '    shift'
  , '    printf "apt-install:%s\\n" "$*" >> "$PW_TEST_DIR/events"'
  , '    exit 0'
  , '    ;;'
  , 'esac'
  , 'exec /bin/bash "$@"'
  ].join('\n')

  delete scripts.dpkg_or_apt_bash

  try {
    Object.keys(scripts).forEach(function(name) {
      fs.writeFileSync(path.join(bin, name), scripts[name] + '\n', {mode: 0o755})
    })
    var result = childProcess.spawnSync(
      '/bin/bash'
    , ['.github/scripts/install-playwright.sh']
    , {
        cwd: path.resolve(import.meta.dirname, '../..')
      , env: Object.assign({}, process.env, {
          PATH: bin + path.delimiter + process.env.PATH
        , PLAYWRIGHT_DIR: pwDir
        , PW_TEST_DIR: directory
        , PW_MOD_DIR: path.join(pwDir, 'node_modules', '@playwright', 'test')
        , PW_FAIL_FIRST_LAUNCH: options.launchFailsOnce ? '1' : '0'
        , NPM_INSTALL_FLAGS: '--no-audit --no-fund'
        })
      , encoding: 'utf8'
      , timeout: 10000
      }
    )
    assert.equal(result.status, 0, result.stderr + '\n' + result.stdout)
    return {
      events: fs.readFileSync(path.join(directory, 'events'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
    , stdout: result.stdout
    , stderr: result.stderr
    }
  }
  finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('install-playwright.sh', function() {
  this.timeout(10000)

  it('should skip npm and apt when cached dependencies launch Chromium cleanly', function() {
    var run = runInstallPlaywright({cachedDeps: true})
    assert.deepEqual(run.events, [
      'npx:playwright install chromium'
    , 'launch:1'
    ])
  })

  it('should install npm packages on cache miss without touching apt when Chromium launches',
    function() {
      var run = runInstallPlaywright({cachedDeps: false})
      assert.deepEqual(run.events, [
        'npm:install --no-audit --no-fund'
      , 'npx:playwright install chromium'
      , 'launch:1'
      ])
    })

  it('should install missing system packages through apt-install.sh when first launch fails',
    function() {
      var run = runInstallPlaywright({
        cachedDeps: true
      , launchFailsOnce: true
      , dryRunOutput:
          'apt-get install -y --no-install-recommends libnss3 libgbm1 fonts-liberation\n'
      })
      assert.deepEqual(run.events, [
        'npx:playwright install chromium'
      , 'launch:1'
      , 'npx:playwright install-deps --dry-run chromium'
      , 'apt-install:libnss3 libgbm1 fonts-liberation'
      , 'launch:2'
      ])
    })

  it('should fall back to playwright install-deps when --dry-run prints no apt-get command',
    function() {
      var run = runInstallPlaywright({
        cachedDeps: true
      , launchFailsOnce: true
      , dryRunOutput: ''
      })
      assert.deepEqual(run.events, [
        'npx:playwright install chromium'
      , 'launch:1'
      , 'npx:playwright install-deps --dry-run chromium'
      , 'npx:playwright install-deps chromium'
      , 'launch:2'
      ])
    })
})
