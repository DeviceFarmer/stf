//
// Shell-parse every `run:` block in the workflows.
//
// A `node -e '...'` step is a single-quoted shell string, so one apostrophe
// inside the program ends the string and hands the rest of it to bash. That
// fails at the moment the step runs, which for a matrix leg means a wasted run,
// and `yamllint`-style checks do not see it because the YAML is perfectly valid.
// `bash -n` on the script GitHub would execute does see it.
//
// usage: node check-run-blocks.mts [workflow.yml...]   (default .github/workflows/*.yml)
//

import fs from 'fs'
import path from 'path'
import os from 'os'
import {createRequire} from 'module'
import childProcess from 'child_process'

interface Step {
  name?: string
  run?: unknown
}

interface Workflow {
  jobs?: Record<string, {steps?: Step[]} | null>
}

interface RunBlock {
  job: string
  name: string
  script: string
}

interface Failure {
  job: string
  name: string
  error: string
}

var yaml = createRequire(import.meta.url)('js-yaml') as {load(source: string): unknown}
var execFileSync = childProcess.execFileSync

function workflows() {
  var dir = '.github/workflows'
  return fs.readdirSync(dir)
    .filter(function(name) {
      return /\.ya?ml$/.test(name)
    })
    .map(function(name) {
      return path.join(dir, name)
    })
}

function runBlocks(file: string) {
  var doc = yaml.load(fs.readFileSync(file, 'utf8')) as Workflow | null | undefined
  var blocks: RunBlock[] = []

  Object.keys((doc && doc.jobs) || {}).forEach(function(job) {
    ((doc!.jobs![job] || {}).steps || []).forEach(function(step, i) {
      if (typeof step.run !== 'string') {
        return
      }
      blocks.push({
        job: job
      , name: step.name || 'step ' + (i + 1)
      , script: step.run
      })
    })
  })

  return blocks
}

function check(file: string) {
  var failures: Failure[] = []

  runBlocks(file).forEach(function(block) {
    // ${{ }} is GitHub template syntax, not shell. Replace it with a plain word
    // so bash sees the shape of the script rather than a bad substitution.
    var script = block.script.replace(/\$\{\{[^}]*\}\}/g, 'GHEXPR')
    var tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stf-runblock-')), 'step.sh'
    )
    fs.writeFileSync(tmp, script)

    try {
      execFileSync('bash', ['-n', tmp], {stdio: ['ignore', 'ignore', 'pipe']})
    }
    catch (e) {
      failures.push({
        job: block.job
      , name: block.name
      , error: ((e as {stderr?: Buffer}).stderr || '').toString().trim().split('\n')[0]!
          .replace(tmp, block.name)
      })
    }
    finally {
      fs.unlinkSync(tmp)
      fs.rmdirSync(path.dirname(tmp))
    }
  })

  return failures
}

function main() {
  var files = process.argv.slice(2)
  if (!files.length) {
    files = workflows()
  }

  var failed = 0
  var checked = 0

  files.forEach(function(file) {
    var blocks = runBlocks(file).length
    checked += blocks
    check(file).forEach(function(f) {
      failed++
      process.stdout.write(
        '::error file=' + file + '::' + f.job + ' / ' + f.name + ': ' +
        f.error + '\n'
      )
    })
  })

  process.stdout.write(
    checked + ' run: block(s) shell-parsed, ' + failed + ' broken\n'
  )
  process.exit(failed ? 1 : 0)
}

if (import.meta.main) {
  main()
}

export {check, runBlocks}
