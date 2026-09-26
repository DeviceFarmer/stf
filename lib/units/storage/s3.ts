/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import http from 'http'
import util from 'util'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

import express from 'express'
import bodyParser from 'body-parser'
import type * as Formidable from 'formidable'
import Promise from 'bluebird'
import * as uuid from 'uuid'
import s3sdk from '@aws-sdk/client-s3'
import credentialProviders from '@aws-sdk/credential-providers'

import logger from '../../util/logger.js'
import download from '../../util/download.js'
import requtil from '../../util/requtil.js'
import type {Readable} from 'stream'

var require = createRequire(import.meta.url)
var formidable: typeof Formidable = require('formidable')

interface S3StorageOptions {
  port: number
  profile: string
  bucket: string
  endpoint: string
  forcePathStyle: boolean
  region: string
  maxFileSize: number
  cacheDir?: string
}

interface UploadedFile {
  path: string
  name?: string | null
}

export default function(options: S3StorageOptions) {
  var log = logger.createLogger('storage:s3')
  var app = express()
  var server = http.createServer(app)

  var s3 = new s3sdk.S3Client({
    credentials: credentialProviders.fromIni({
      profile: options.profile
    })
  , endpoint: options.endpoint
  , forcePathStyle: options.forcePathStyle
  , region: options.region
  , requestChecksumCalculation: 'WHEN_REQUIRED'
  })

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(bodyParser.json())

  app.disable('x-powered-by')

  function putObject(plugin: string, file: UploadedFile) {
    var id = uuid.v4()

    return Promise.promisify<
      fs.Stats, fs.PathLike
    >(fs.stat, fs as Promise.PromisifyOptions)(file.path)
      .then(function(stat) {
        return s3.send(new s3sdk.PutObjectCommand({
          Key: id
        , Body: fs.createReadStream(file.path)
        , ContentLength: stat.size
        , Bucket: options.bucket
        , Metadata: {
            plugin: plugin
          , name: file.name as string
          }
        }))
      })
      .then(function() {
        log.info('Stored "%s" as "%s/%s"', file.name, options.bucket, id)
        return id
      })
      .catch(function(err) {
        log.error(
          'Unable to store "%s" as "%s/%s"'
        , file.path
        , options.bucket
        , id
        , err.stack
        )
        throw err
      })
  }

  function getHref(plugin: string, id: string, name: string | null | undefined) {
    return util.format(
      '/s/%s/%s%s'
    , plugin
    , id
    , name ? '/' + path.basename(name) : ''
    )
  }

  app.post('/s/upload/:plugin', function(req, res) {
    var form = new formidable.IncomingForm({
      maxFileSize: options.maxFileSize
    , allowEmptyFiles: true
    , minFileSize: 0
    })
    var plugin = req.params.plugin
    // Formidable appends to files[field] from the write stream flush callback,
    // so the array ends up in completion order. Tag each file as it is announced
    // to recover the actual submission order.
    var sequence = 0
    form.on('fileBegin', function(name, file) {
      file.submissionSequence = sequence++
    })
    Promise.promisify<
      [Formidable.Fields, Formidable.Files], http.IncomingMessage
    >(form.parse, {context: form, multiArgs: true})(req)
      .spread(function(
        fields: Formidable.Fields | Formidable.Files
      , files: Formidable.Fields | Formidable.Files
      ) {
        var requests = Object.keys(files).map(function(field) {
          var uploaded = (files as Formidable.Files)[field]!.reduce(function(latest, candidate) {
            return candidate.submissionSequence! > latest.submissionSequence! ?
              candidate : latest
          })
          var file = {
            name: uploaded.originalFilename
          , path: uploaded.filepath
          }
          log.info('Uploaded "%s" to "%s"', file.name, file.path)
          return putObject(plugin, file)
            .then(function(id) {
              return {
                field: field
              , id: id
              , name: file.name
              , temppath: file.path
              }
            })
        })
        return Promise.all(requests)
      })
      .then(function(storedFiles) {
        res.status(201).json({
          success: true
        , resources: (function() {
            var mapped = Object.create(null)
            storedFiles.forEach(function(file) {
              mapped[file.field] = {
                date: new Date()
              , plugin: plugin
              , id: file.id
              , name: file.name
              , href: getHref(plugin, file.id, file.name)
              }
            })
            return mapped
          })()
        })
        return storedFiles
      })
      .then(function(storedFiles) {
        return Promise.all(storedFiles.map(function(file) {
          return Promise.promisify(fs.unlink, {context: fs})(file.temppath)
            .catch(function(err) {
              log.warn('Unable to clean up "%s"', file.temppath, err.stack)
              return true
            })
        }))
      })
      .catch(function(err) {
        log.error('Error storing resource', err.stack)
        res.status(500)
          .json({
            success: false
          , error: 'ServerError'
          })
      })
  })

  app.post('/s/download/:plugin', requtil.validators.tempUrlValidator,
    function(req: express.Request<{plugin: string}>, res: express.Response) {
      var plugin = req.params.plugin
      requtil.validate(req)
        .then(function() {
          return download(req.body.url, {
            dir: options.cacheDir
          })
        })
        .then(function(file) {
          file.name = crypto.createHash('md5').update(req.body.url).digest('hex')
          return putObject(plugin, file)
            .then(function(id) {
              return {
                id: id
              , name: file.name
              , temppath: file.path
              }
            })
        })
        .then(function(file) {
          res.status(201)
            .json({
              success: true
            , resource: {
                date: new Date()
              , plugin: plugin
              , id: file.id
              , name: file.name
              , href: getHref(plugin, file.id, file.name)
              }
            })
          return file
        })
        .then(function(file) {
          return Promise.promisify<
            void, fs.PathLike
          >(fs.unlink, fs as Promise.PromisifyOptions)(file.temppath)
            .catch(function(err) {
              log.warn('Unable to clean up "%s"', file.temppath, err.stack)
              return true
            })
        })
        .catch(requtil.ValidationError, function(err) {
          res.status(400)
            .json({
              success: false
            , error: 'ValidationError'
            , validationErrors: err.errors
            })
        })
        .catch(function(err) {
          log.error('Error storing resource', err.stack)
          res.status(500)
            .json({
              success: false
            , error: 'ServerError'
            })
        })
    })

  app.get('/s/blob/:id/:name', function(req, res) {
    Promise.resolve(s3.send(new s3sdk.GetObjectCommand({
      Key: req.params.id
    , Bucket: options.bucket
    })))
      .then(function(data) {
        if (data.ContentType) {
          res.set('Content-Type', data.ContentType)
        }
        (data.Body as Readable).pipe(res)
      })
      .catch(function(err) {
        log.error('Unable to retrieve "%s"', req.params.id, err.stack)
        res.sendStatus(404)
      })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
