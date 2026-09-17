var cp = require('child_process')
var fs = require('fs/promises')
var os = require('os')
var path = require('path')
var util = require('util')

var expect = require('chai').expect

var execFile = util.promisify(cp.execFile)

describe('Gulp clean', function() {
  this.timeout(10000)

  var directory

  beforeEach(async function() {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-clean-'))
  })

  afterEach(async function() {
    await fs.rm(directory, {recursive: true, force: true})
  })

  it('should remove generated files, preserve sources and tolerate already-clean paths', async function() {
    await fs.mkdir(path.join(directory, 'tmp', 'nested'), {recursive: true})
    await fs.mkdir(path.join(directory, 'res', 'build'), {recursive: true})
    await fs.writeFile(path.join(directory, 'tmp', 'nested', 'output'), 'temporary')
    await fs.writeFile(path.join(directory, 'res', 'build', 'bundle.js'), 'generated')
    await fs.writeFile(path.join(directory, '.eslintcache'), 'cached')
    await fs.writeFile(path.join(directory, 'source.js'), 'source')

    var script = [
      "var gulp = require('gulp')"
    , 'require(' + JSON.stringify(require.resolve('../../gulpfile')) + ')'
    , 'process.chdir(process.argv[1])'
    , "gulp.series('clean')(function(error) { if (error) { console.error(error); process.exitCode = 1 } })"
    ].join(';')

    for (var run = 0; run < 2; run++) {
      await execFile(process.execPath, ['-e', script, directory], {
        cwd: path.resolve(__dirname, '../..')
      })
      expect((await fs.readdir(directory)).sort()).to.deep.equal(['res', 'source.js'])
      expect(await fs.readdir(path.join(directory, 'res'))).to.deep.equal([])
      expect(await fs.readFile(path.join(directory, 'source.js'), 'utf8')).to.equal('source')
    }
  })
})
