var fs = require('fs/promises')
var http = require('http')

var expect = require('chai').expect

var download = require('../../lib/util/download')

describe('download', function() {
  it('should reject instead of crashing when the source is unreachable', async function() {
    var server = http.createServer()
    await new Promise(function(resolve) {
      server.listen(0, '127.0.0.1', resolve)
    })
    var port = server.address().port
    await new Promise(function(resolve) {
      server.close(resolve)
    })

    var error = await download('http://127.0.0.1:' + port + '/missing.apk', {dir: require('os').tmpdir()})
      .then(function() {
        return null
      }, function(err) {
        return err
      })

    expect(error).to.be.an('error')
    expect(error.code).to.equal('ECONNREFUSED')
  })

  it('should save the response body to a temporary file', async function() {
    var server = http.createServer(function(req, res) {
      res.end('apk-bytes')
    })
    await new Promise(function(resolve) {
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      var result = await download('http://127.0.0.1:' + server.address().port + '/app.apk', {
        dir: require('os').tmpdir()
      })
      expect(await fs.readFile(result.path, 'utf8')).to.equal('apk-bytes')
      await fs.rm(result.path, {force: true})
    }
    finally {
      await new Promise(function(resolve) {
        server.close(resolve)
      })
    }
  })
})
