import fs from 'fs'
import os from 'os'
import path from 'path'

import * as chai from 'chai'
var expect = chai.expect

import {findProblems} from '../../lib/util/depcheck.js'

describe('depcheck', function() {
  var parent: string, root: string

  function writeJson(file: string, value: object) {
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, JSON.stringify(value))
  }

  function install(name: string, version: string, dir = root) {
    writeJson(path.join(dir, 'node_modules', name, 'package.json'), {name, version})
  }

  beforeEach(function() {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-depcheck-'))
    root = path.join(parent, 'stf')
    writeJson(path.join(root, 'package.json'), {
      engines: {node: '>= 22.18.0'}
    , dependencies: {
        a: '^1.2.0'
      , '@scope/b': '~2.0.0'
      , c: 'github:someone/c'
      , d: 'https://example.org/d.tgz'
      }
    })
  })

  afterEach(function() {
    fs.rmSync(parent, {recursive: true, force: true})
  })

  it('should pass when every dependency satisfies its range', function() {
    install('a', '1.4.0')
    install('@scope/b', '2.0.3')
    expect(findProblems(root, 'v22.18.0')).to.deep.equal([])
  })

  it('should report an outdated or missing dependency', function() {
    install('a', '1.1.9')
    expect(findProblems(root, 'v22.18.0')).to.deep.equal([
      'a is 1.1.9 but needs to be ^1.2.0'
    , '@scope/b is not installed'
    ])
  })

  it('should report an unsupported Node version', function() {
    install('a', '1.4.0')
    install('@scope/b', '2.0.3')
    expect(findProblems(root, 'v20.19.0')).to.deep.equal([
      'node is v20.19.0 but needs to be >= 22.18.0'
    ])
  })

  it('should accept a newer prerelease Node version', function() {
    install('a', '1.4.0')
    install('@scope/b', '2.0.3')
    expect(findProblems(root, 'v24.0.0-rc.1')).to.deep.equal([])
  })

  it('should find dependencies hoisted above the root', function() {
    install('a', '1.4.0', parent)
    install('@scope/b', '2.0.3', parent)
    expect(findProblems(root, 'v22.18.0')).to.deep.equal([])
  })

  it('should prefer the closest installed copy', function() {
    install('a', '1.1.9')
    install('a', '1.4.0', parent)
    install('@scope/b', '2.0.3')
    expect(findProblems(root, 'v22.18.0')).to.deep.equal([
      'a is 1.1.9 but needs to be ^1.2.0'
    ])
  })
})
