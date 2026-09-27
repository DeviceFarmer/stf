import cp from 'node:child_process'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'

import {expect} from 'chai'

var execFile = util.promisify(cp.execFile)
const require = createRequire(import.meta.url)

describe('Build clean', function() {
  this.timeout(10000)

  var directory: string

  beforeEach(async function() {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-clean-'))
  })

  afterEach(async function() {
    await fs.rm(directory, {recursive: true, force: true})
  })

  it('should remove generated files, preserve sources and tolerate already-clean paths',
    async function() {
      await fs.mkdir(path.join(directory, 'tmp', 'nested'), {recursive: true})
      await fs.mkdir(path.join(directory, 'res', 'build'), {recursive: true})
      await fs.writeFile(path.join(directory, 'tmp', 'nested', 'output'), 'temporary')
      await fs.writeFile(path.join(directory, 'res', 'build', 'bundle.js'), 'generated')
      await fs.writeFile(path.join(directory, '.eslintcache'), 'cached')
      await fs.writeFile(path.join(directory, 'source.js'), 'source')

      for (var run = 0; run < 2; run++) {
        await execFile(process.execPath, [require.resolve('../../build.mts'), 'clean'], {
          cwd: directory
        })
        expect((await fs.readdir(directory)).sort()).to.deep.equal(['res', 'source.js'])
        expect(await fs.readdir(path.join(directory, 'res'))).to.deep.equal([])
        expect(await fs.readFile(path.join(directory, 'source.js'), 'utf8')).to.equal('source')
      }
    })
})
