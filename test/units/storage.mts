import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import {createRequire} from 'node:module'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {Readable} from 'node:stream'

import {expect} from 'chai'
import type * as Formidable from 'formidable'
import sinon from 'sinon'
import s3sdk from '@aws-sdk/client-s3'

import Storage from '../../lib/util/storage.js'
import deviceStorageSyrup from '../../lib/units/device/support/storage.js'
import getImage from '../../lib/units/storage/plugins/image/task/get.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

interface UploadFile {
  field?: string
  name: string
  bytes: Buffer | string
}

interface Resource {
  id: string
  name: string
  href: string
}

interface UploadResult {
  success: boolean
  resources: Record<'file' | 'first' | 'second', Resource>
}

interface S3Input {
  Body: AsyncIterable<Buffer>
  ContentLength: number
  Metadata: Record<string, string>
  Key: string
}

const require = createRequire(import.meta.url)
var formidable: typeof Formidable = require('formidable')

;['temp', 's3'].forEach(function(backend) {
  describe('storage-' + backend + ' multipart uploads', function() {
    var directory: string, server: http.Server, origin: string, storage: Storage
      , sandbox: sinon.SinonSandbox, converted: sinon.SinonStub
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
        var objects = new Map<string, Buffer>()
        sandbox.stub(s3sdk.S3Client.prototype, 'send').callsFake(async function(command) {
          var input = command.input as unknown as S3Input
          if (command instanceof s3sdk.PutObjectCommand) {
            var chunks: Buffer[] = []
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

      var restoreStorage = mockModule(new URL('../../lib/util/storage.js', import.meta.url), {
        default: function() {
          storage = new Storage()
          return storage
        }
      })
      var restoreBundle = mockModule(new URL('../../lib/util/bundletool.js', import.meta.url), {
        default: converted
      })

      var createServer = http.createServer
      var capture = sandbox.stub(http, 'createServer').callsFake(function(app) {
        server = createServer.call(http, app)
        return server
      })
      try {
        var unit = await importFresh(
          new URL('../../lib/units/storage/' + backend + '.js', import.meta.url)
        )
        unit.default({
          port: 0
        , maxFileSize: 16
        , saveDir: directory
        , region: 'us-east-1'
        , bucket: 'multipart-test'
        })
      }
      finally {
        capture.restore()
        restoreStorage()
        restoreBundle()
      }
      await new Promise<void>(function(resolve) {
        server.once('listening', resolve)
      })
      origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
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

    async function upload(files: UploadFile[]) {
      var form = new FormData()
      files.forEach(function(file) {
        form.append(file.field || 'file', new Blob([file.bytes], {type: contentType}), file.name)
      })
      return fetch(origin + '/s/upload/apk', {method: 'POST', body: form})
    }

    async function read(resource: Resource) {
      var response = await fetch(origin + resource.href.replace('/s/apk/', '/s/blob/'))
      expect(response.status).to.equal(200)
      return Buffer.from(await response.arrayBuffer())
    }

    it('should round-trip binary bytes and preserve the resource name', async function() {
      var response = await upload([{name: 'sample.apk', bytes: bytes}])
      expect(response.status).to.equal(201)
      var resource = (await response.json() as UploadResult).resources.file
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
      expect(await read((await response.json() as UploadResult).resources.file))
        .to.deep.equal(Buffer.from('second'))
    })

    it('should retain files submitted under different fields', async function() {
      var response = await upload([
        {field: 'first', name: 'first.apk', bytes: 'first'}
      , {field: 'second', name: 'second.apk', bytes: 'second'}
      ])
      expect(response.status).to.equal(201)
      var resources = (await response.json() as UploadResult).resources
      expect(await read(resources.first)).to.deep.equal(Buffer.from('first'))
      expect(await read(resources.second)).to.deep.equal(Buffer.from('second'))
    })

    it('should accept an empty file', async function() {
      var response = await upload([{name: 'empty.apk', bytes: ''}])
      expect(response.status).to.equal(201)
      expect(await read((await response.json() as UploadResult).resources.file)).to.have.length(0)
    })

    it('should reject files beyond the configured size limit', async function() {
      var response = await upload([{name: 'large.apk', bytes: Buffer.alloc(17)}])
      expect(response.status).to.equal(500)
      expect((await response.json() as UploadResult).success).to.equal(false)
    })

    it('should apply the size limit to the total upload', async function() {
      var response = await upload([
        {field: 'first', name: 'first.apk', bytes: Buffer.alloc(10)}
      , {field: 'second', name: 'second.apk', bytes: Buffer.alloc(10)}
      ])
      expect(response.status).to.equal(500)
      expect((await response.json() as UploadResult).success).to.equal(false)
    })

    it('should accept the device request client and return a readable stream', async function() {
      var client = deviceStorageSyrup.invoke({storageUrl: origin + '/'})
      var resource = await client.store('apk', Readable.from([bytes]), {
        filename: 'device.apk'
      , contentType: contentType
      , knownLength: bytes.length
      })
      var chunks: Buffer[] = []
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
        expect(await read((await response.json() as UploadResult).resources.file))
          .to.deep.equal(bytes)
      })
    }
  })
})

describe('storage image plugin', function() {
  var blobServer: http.Server, server: http.Server, origin: string
  var bytes = Buffer.from([255, 216, 255, 217])

  before(async function() {
    blobServer = http.createServer(function(req, res) {
      res.end(bytes)
    })
    await new Promise<void>(function(resolve) {
      blobServer.listen(0, '127.0.0.1', resolve)
    })

    var restoreTransform = mockModule(
      new URL('../../lib/units/storage/plugins/image/task/transform.js', import.meta.url)
    , {
        default: function(stream: Readable) {
          return Promise.resolve(stream)
        }
      }
    )

    var createServer = http.createServer
    var capture = sinon.stub(http, 'createServer').callsFake(function(app) {
      server = createServer.call(http, app)
      return server
    })
    try {
      var unit = await importFresh(
        new URL('../../lib/units/storage/plugins/image/index.js', import.meta.url)
      )
      unit.default({
        port: 0
      , concurrency: 1
      , storageUrl: 'http://127.0.0.1:' + (blobServer.address() as AddressInfo).port + '/'
      })
    }
    finally {
      capture.restore()
      restoreTransform()
    }
    await new Promise<void>(function(resolve) {
      server.once('listening', resolve)
    })
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  })

  after(async function() {
    await Promise.all([server, blobServer].map(function(instance) {
      return new Promise(function(resolve) {
        instance.close(resolve)
      })
    }))
  })

  it('should name downloads after the requested resource', async function() {
    var response = await fetch(origin + '/s/image/some-id/emulator-5554.jpg?download')
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-disposition'))
      .to.equal('attachment; filename="emulator-5554.jpg"')
    expect(Buffer.from(await response.arrayBuffer())).to.deep.equal(bytes)
  })
})
