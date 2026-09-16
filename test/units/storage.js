var crypto = require('crypto')
var fs = require('fs/promises')
var http = require('http')
var os = require('os')
var path = require('path')
var Readable = require('stream').Readable

var expect = require('chai').expect
var formidable = require('formidable')
var sinon = require('sinon')
var s3sdk = require('@aws-sdk/client-s3')

var Storage = require('../../lib/util/storage')
var deviceStorage = require('../../lib/units/device/support/storage')
var getImage = require('../../lib/units/storage/plugins/image/task/get')

;['temp', 's3'].forEach(function(backend) {
  describe('storage-' + backend + ' multipart uploads', function() {
    var directory, server, origin, storage, sandbox, converted
    var bytes = Buffer.from([0, 255, 42, 13, 10])
    var contentType = 'application/vnd.android.package-archive'

    before(async function() {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-multipart-'))
      sandbox = sinon.createSandbox()
      converted = sinon.stub().callsFake(function(options) {
        return Promise.resolve(options.file)
      })

      var IncomingForm = formidable.IncomingForm
      sandbox.stub(formidable, 'IncomingForm').callsFake(function(options) {
        return new IncomingForm(Object.assign({}, options, {uploadDir: directory}))
      })

      if (backend === 's3') {
        var objects = new Map()
        sandbox.stub(s3sdk.S3Client.prototype, 'send').callsFake(async function(command) {
          var input = command.input
          if (command instanceof s3sdk.PutObjectCommand) {
            var chunks = []
            for await (var chunk of input.Body) {
              chunks.push(chunk)
            }
            var body = Buffer.concat(chunks)
            expect(input.ContentLength).to.equal(body.length)
            expect(input.Metadata.plugin).to.equal('apk')
            expect(input.Metadata.name).to.be.a('string')
            objects.set(input.Key, body)
            return {}
          }
          expect(command).to.be.instanceOf(s3sdk.GetObjectCommand)
          return {Body: Readable.from([objects.get(input.Key)])}
        })
      }

      var storagePath = require.resolve('../../lib/util/storage')
      var bundlePath = require.resolve('../../lib/util/bundletool')
      var unitPath = require.resolve('../../lib/units/storage/' + backend)
      var cachedStorage = require.cache[storagePath]
      var cachedBundle = require.cache[bundlePath]
      var cachedUnit = require.cache[unitPath]
      require.cache[storagePath] = {exports: function() {
        storage = new Storage()
        return storage
      }}
      require.cache[bundlePath] = {exports: converted}
      delete require.cache[unitPath]

      var createServer = http.createServer
      var capture = sandbox.stub(http, 'createServer').callsFake(function(app) {
        server = createServer.call(http, app)
        return server
      })
      try {
        require(unitPath)({
          port: 0
        , maxFileSize: 16
        , saveDir: directory
        , region: 'us-east-1'
        , bucket: 'multipart-test'
        })
      }
      finally {
        capture.restore()
        ;[[storagePath, cachedStorage], [bundlePath, cachedBundle], [unitPath, cachedUnit]]
          .forEach(function(entry) {
            if (entry[1]) {
              require.cache[entry[0]] = entry[1]
            }
            else {
              delete require.cache[entry[0]]
            }
          })
      }
      await new Promise(function(resolve) {
        server.once('listening', resolve)
      })
      origin = 'http://127.0.0.1:' + server.address().port
    })

    after(async function() {
      if (server) {
        await new Promise(function(resolve) {
          server.close(resolve)
        })
      }
      if (storage) {
        storage.stop()
      }
      sandbox.restore()
      await fs.rm(directory, {recursive: true, force: true})
    })

    async function upload(files) {
      var form = new FormData()
      files.forEach(function(file) {
        form.append(file.field || 'file', new Blob([file.bytes], {type: contentType}), file.name)
      })
      return fetch(origin + '/s/upload/apk', {method: 'POST', body: form})
    }

    async function read(resource) {
      var response = await fetch(origin + resource.href.replace('/s/apk/', '/s/blob/'))
      expect(response.status).to.equal(200)
      return Buffer.from(await response.arrayBuffer())
    }

    it('should round-trip binary bytes and preserve the resource name', async function() {
      var response = await upload([{name: 'sample.apk', bytes: bytes}])
      expect(response.status).to.equal(201)
      var resource = (await response.json()).resources.file
      var name = backend === 'temp' ?
        crypto.createHash('md5').update('sample.apk').digest('hex') : 'sample.apk'
      expect(resource.name).to.equal(name)
      expect(resource.href).to.equal('/s/apk/' + resource.id + '/' + name)
      expect(await read(resource)).to.deep.equal(bytes)
      if (backend === 'temp') {
        var blob = await fetch(origin + resource.href.replace('/s/apk/', '/s/blob/'))
        expect(blob.headers.get('content-type')).to.equal(contentType)
        await blob.arrayBuffer()
      }
    })

    it('should keep the last file when a field is repeated', async function() {
      var response = await upload([
        {name: 'first.apk', bytes: 'first'}
      , {name: 'second.apk', bytes: 'second'}
      ])
      expect(response.status).to.equal(201)
      expect(await read((await response.json()).resources.file))
        .to.deep.equal(Buffer.from('second'))
    })

    it('should retain files submitted under different fields', async function() {
      var response = await upload([
        {field: 'first', name: 'first.apk', bytes: 'first'}
      , {field: 'second', name: 'second.apk', bytes: 'second'}
      ])
      expect(response.status).to.equal(201)
      var resources = (await response.json()).resources
      expect(await read(resources.first)).to.deep.equal(Buffer.from('first'))
      expect(await read(resources.second)).to.deep.equal(Buffer.from('second'))
    })

    it('should accept an empty file', async function() {
      var response = await upload([{name: 'empty.apk', bytes: ''}])
      expect(response.status).to.equal(201)
      expect(await read((await response.json()).resources.file)).to.have.length(0)
    })

    it('should reject files beyond the configured size limit', async function() {
      var response = await upload([{name: 'large.apk', bytes: Buffer.alloc(17)}])
      expect(response.status).to.equal(500)
      expect((await response.json()).success).to.equal(false)
    })

    it('should apply the size limit to the total upload', async function() {
      var response = await upload([
        {field: 'first', name: 'first.apk', bytes: Buffer.alloc(10)}
      , {field: 'second', name: 'second.apk', bytes: Buffer.alloc(10)}
      ])
      expect(response.status).to.equal(500)
      expect((await response.json()).success).to.equal(false)
    })

    it('should accept the device request client and return a readable stream', async function() {
      var client = deviceStorage.invoke({storageUrl: origin + '/'})
      var resource = await client.store('apk', Readable.from([bytes]), {
        filename: 'device.apk'
      , contentType: contentType
      , knownLength: bytes.length
      })
      var chunks = []
      await getImage(resource.href.replace('/s/apk/', '/s/blob/'), {
        storageUrl: origin + '/'
      }).then(function(stream) {
        return new Promise(function(resolve, reject) {
          stream.on('data', function(chunk) {
            chunks.push(chunk)
          })
          stream.on('error', reject)
          stream.on('end', resolve)
        })
      })
      expect(Buffer.concat(chunks)).to.deep.equal(bytes)
    })

    if (backend === 'temp') {
      it('should identify AAB files before hashing the filename', async function() {
        converted.resetHistory()
        var response = await upload([{name: 'sample.aab', bytes: bytes}])
        expect(response.status).to.equal(201)
        expect(converted.calledOnce).to.equal(true)
        expect(converted.firstCall.args[0].file.isAab).to.equal(true)
        expect(await read((await response.json()).resources.file)).to.deep.equal(bytes)
      })
    }
  })
})
