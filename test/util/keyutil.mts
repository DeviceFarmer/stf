import path from 'node:path'
import fs from 'node:fs'
import {createRequire} from 'node:module'

import * as chai from 'chai'
var expect = chai.expect

import keyutil from '../../lib/util/keyutil.js'

const require = createRequire(import.meta.url)

describe('keyutil', function() {
  describe('parseKeyCharacterMap', function() {
    it('should be able to parse Virtual.kcm', function(done) {
      var expected = require('../fixt/Virtual.kcm.json')
      var source = path.join(import.meta.dirname, '..', 'fixt', 'Virtual.kcm')

      keyutil.parseKeyCharacterMap(fs.createReadStream(source))
        .then(function(keymap) {
          expect(keymap).to.eql(expected)
          done()
        })
        .catch(done)
    })
  })
})
