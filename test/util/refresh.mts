import fs from 'node:fs'
import {createRequire} from 'node:module'

import * as chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
var expect = chai.expect
chai.use(sinonChai)

import refresh from '../../lib/util/refresh.js'

const require = createRequire(import.meta.url)

describe('refresh', function() {
  var watchedPath = '/stf-test/refresh/watched.js'

  beforeEach(function() {
    require.cache[watchedPath] = {} as NodeJS.Module
  })

  afterEach(function() {
    delete require.cache[watchedPath]
    sinon.restore()
  })

  it('should send SIGHUP to the current process when a watched file changes', function() {
    var watch = sinon.stub(fs, 'watch').returns({} as fs.FSWatcher)
    var kill = sinon.stub(process, 'kill')

    refresh()

    expect(watch).to.have.been.calledWith(watchedPath)
    ;(watch.withArgs(watchedPath).firstCall.args[1] as () => void)()
    expect(kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGHUP')
  })
})
