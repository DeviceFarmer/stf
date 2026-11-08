import * as chai from 'chai'
var expect = chai.expect

import urlutil from '../../lib/util/urlutil.js'

describe('urlutil', function() {
  describe('toLocalPath', function() {
    it('should keep ordinary paths intact', function() {
      expect(urlutil.toLocalPath('/')).to.equal('/')
      expect(urlutil.toLocalPath('/#!/control/abc?x=1')).to.equal('/#!/control/abc?x=1')
    })

    it('should collapse leading slashes so the result is never protocol-relative', function() {
      expect(urlutil.toLocalPath('//evil.example/path')).to.equal('/evil.example/path')
      expect(urlutil.toLocalPath('///evil.example')).to.equal('/evil.example')
    })

    it('should collapse leading backslashes that browsers treat as slashes', function() {
      expect(urlutil.toLocalPath('/\\evil.example')).to.equal('/evil.example')
      expect(urlutil.toLocalPath('\\\\evil.example')).to.equal('/evil.example')
    })
  })

  describe('removeParam', function() {
    it('should drop only the named parameter', function() {
      expect(urlutil.removeParam('/?jwt=a&b=2', 'jwt')).to.equal('/?b=2')
    })
  })
})
