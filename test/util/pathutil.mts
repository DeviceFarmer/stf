import fs from 'fs'
import os from 'os'
import path from 'path'

import * as chai from 'chai'
var expect = chai.expect

import pathutil from '../../lib/util/pathutil.js'

describe('pathutil', function() {
  describe('root', function() {
    it('should resolve a path relative to the repo root', function() {
      var resolved = pathutil.root('package.json')
      expect(fs.existsSync(resolved)).to.be.true
      expect(path.basename(resolved)).to.equal('package.json')
    })

    it('should support resolving from an explicit base directory', function() {
      var custom = pathutil.root('custom.txt', '/tmp')
      expect(custom).to.equal(path.resolve('/tmp', 'custom.txt'))
    })
  })

  describe('resource', function() {
    it('should resolve a path relative to the res/ directory', function() {
      var resolved = pathutil.resource('wiki')
      expect(fs.existsSync(resolved)).to.be.true
      expect(resolved).to.include(path.join('res', 'wiki'))
    })
  })

  describe('match', function() {
    it('should return the first candidate path that exists', function() {
      var hit = pathutil.resource('wiki')
      var miss = pathutil.resource('nonexistent-resource-file')
      expect(pathutil.match([miss, hit])).to.equal(hit)
    })

    it('should return null when no candidate exists', function() {
      var miss1 = pathutil.resource('nonexistent-1')
      var miss2 = pathutil.resource('nonexistent-2')
      expect(pathutil.match([miss1, miss2])).to.be.null
    })
  })

  describe('requiredMatch', function() {
    it('should return the first candidate path that exists', function() {
      var hit = pathutil.resource('wiki')
      var miss = pathutil.resource('nonexistent-resource-file')
      expect(pathutil.requiredMatch([miss, hit])).to.equal(hit)
    })

    it('should throw an error listing candidate paths when none exist', function() {
      var miss1 = pathutil.resource('nonexistent-1')
      var miss2 = pathutil.resource('nonexistent-2')
      expect(function() {
        pathutil.requiredMatch([miss1, miss2])
      }).to.throw(/At least one of these paths should exist/)
    })
  })

  describe('module', function() {
    var parentDir: string, appDir: string

    function writeJson(file: string, value: object) {
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, JSON.stringify(value))
    }

    function createDummyFile(filePath: string, content = 'dummy') {
      fs.mkdirSync(path.dirname(filePath), {recursive: true})
      fs.writeFileSync(filePath, content)
    }

    beforeEach(function() {
      parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-pathutil-'))
      appDir = path.join(parentDir, 'node_modules', '@devicefarmer', 'stf')
      fs.mkdirSync(appDir, {recursive: true})
    })

    afterEach(function() {
      fs.rmSync(parentDir, {recursive: true, force: true})
    })

    it('should resolve a module from local node_modules when present', function() {
      var localFile = path.join(
        appDir
      , 'node_modules'
      , '@devicefarmer'
      , 'minicap-prebuilt'
      , 'prebuilt'
      , 'arm64-v8a'
      , 'bin'
      , 'minicap'
      )
      createDummyFile(localFile)

      var resolved = pathutil.module(
        '@devicefarmer/minicap-prebuilt/prebuilt/arm64-v8a/bin/minicap'
      , appDir
      )
      expect(resolved).to.equal(localFile)
    })

    it('should find a hoisted scoped module in an ancestor node_modules', function() {
      var hoistedFile = path.join(
        parentDir
      , 'node_modules'
      , '@devicefarmer'
      , 'minicap-prebuilt'
      , 'prebuilt'
      , 'arm64-v8a'
      , 'bin'
      , 'minicap'
      )
      createDummyFile(hoistedFile)

      var resolved = pathutil.module(
        '@devicefarmer/minicap-prebuilt/prebuilt/arm64-v8a/bin/minicap'
      , appDir
      )
      expect(resolved).to.equal(hoistedFile)
    })

    it('should find a hoisted unscoped module in an ancestor node_modules', function() {
      var hoistedFile = path.join(
        parentDir
      , 'node_modules'
      , 'some-package'
      , 'dist'
      , 'index.js'
      )
      createDummyFile(hoistedFile)

      var resolved = pathutil.module('some-package/dist/index.js', appDir)
      expect(resolved).to.equal(hoistedFile)
    })

    it('should resolve candidate subpaths inside a hoisted module when file absent', function() {
      writeJson(
        path.join(
          parentDir
        , 'node_modules'
        , '@devicefarmer'
        , 'minicap-prebuilt'
        , 'package.json'
        )
      , {name: '@devicefarmer/minicap-prebuilt', version: '1.0.0'}
      )

      var resolved = pathutil.module(
        '@devicefarmer/minicap-prebuilt/prebuilt/missing-abi/bin/minicap'
      , appDir
      )
      var expected = path.join(
        parentDir
      , 'node_modules'
      , '@devicefarmer'
      , 'minicap-prebuilt'
      , 'prebuilt'
      , 'missing-abi'
      , 'bin'
      , 'minicap'
      )
      expect(resolved).to.equal(expected)
    })

    it('should prefer closest installed module when present in multiple ancestors', function() {
      var localFile = path.join(appDir, 'node_modules', 'dep', 'foo.js')
      var hoistedFile = path.join(parentDir, 'node_modules', 'dep', 'foo.js')
      createDummyFile(localFile, 'local')
      createDummyFile(hoistedFile, 'hoisted')

      var resolved = pathutil.module('dep/foo.js', appDir)
      expect(resolved).to.equal(localFile)
    })

    it('should fall back to resolving against root node_modules when not found', function() {
      var resolved = pathutil.module('@devicefarmer/missing/file.txt', appDir)
      var expected = path.resolve(
        appDir
      , 'node_modules'
      , '@devicefarmer'
      , 'missing'
      , 'file.txt'
      )
      expect(resolved).to.equal(expected)
    })
  })
})
