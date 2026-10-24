import fs from 'fs'
import os from 'os'
import path from 'path'

import * as chai from 'chai'
var expect = chai.expect

import {findProblems} from '../../lib/util/depcheck.js'

describe('depcheck', function() {
  var root: string

  function writeJson(file: string, value: object) {
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, JSON.stringify(value))
  }

  function install(name: string, version: string) {
    writeJson(path.join(root, 'node_modules', name, 'package.json'), {name, version})
  }

  beforeEach(function() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-depcheck-'))
    fs.mkdirSync(path.join(root, '.git'))
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
    fs.rmSync(root, {recursive: true, force: true})
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

  it('should only check the Node version outside a source checkout', function() {
    fs.rmdirSync(path.join(root, '.git'))
    expect(findProblems(root, 'v22.18.0')).to.deep.equal([])
    expect(findProblems(root, 'v20.19.0')).to.have.length(1)
  })
})
