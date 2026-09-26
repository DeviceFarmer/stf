/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import http from 'http'
import util from 'util'
import path from 'path'
import crypto from 'crypto'

import express from 'express'
import bodyParser from 'body-parser'
import type * as Formidable from 'formidable'
import Promise from 'bluebird'

import logger from '../../util/logger.js'
import Storage from '../../util/storage.js'
import requtil from '../../util/requtil.js'
import download from '../../util/download.js'
import bundletool from '../../util/bundletool.js'

var require = createRequire(import.meta.url)
var formidable: typeof Formidable = require('formidable')

type UploadForm = InstanceType<typeof formidable.IncomingForm> & {uploadDir?: string}

interface TempStorageOptions {
  port: number
  saveDir: string
  maxFileSize: number
  bundletoolPath: string
  keystore: Parameters<typeof bundletool>[0]['keystore']
  cacheDir?: string
}

export default function(options: TempStorageOptions) {
  var log = logger.createLogger('storage:temp')
  var app = express()
  var server = http.createServer(app)
  var storage = new Storage()

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(bodyParser.json())

  app.disable('x-powered-by')

  storage.on('timeout', function(id) {
    log.info('Cleaning up inactive resource "%s"', id)
  })

  app.post('/s/download/:plugin', requtil.validators.tempUrlValidator, function(
    req: express.Request
  , res: express.Response
  ) {
    requtil.validate(req)
      .then(function() {
        return download(req.body.url, {
          dir: options.cacheDir
        })
      })
      .then(function(file) {
        file.name = crypto.createHash('md5').update(req.body.url).digest('hex')
        return {
          id: storage.store(file)
        , name: file.name
        }
      })
      .then(function(file) {
        var plugin = req.params.plugin
        res.status(201)
          .json({
            success: true
          , resource: {
              date: new Date()
            , plugin: plugin
            , id: file.id
            , name: file.name
            , href: util.format(
                '/s/%s/%s%s'
              , plugin
              , file.id
              , file.name ? util.format('/%s', path.basename(file.name)) : ''
              )
            }
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

  app.post('/s/upload/:plugin', function(req, res) {
    var form: UploadForm = new formidable.IncomingForm({
      maxFileSize: options.maxFileSize
    , allowEmptyFiles: true
    , minFileSize: 0
    })
    if (options.saveDir) {
      form.uploadDir = options.saveDir
    }
    // Formidable appends to files[field] from the write stream flush callback,
    // so the array ends up in completion order. Tag each file as it is announced
    // to recover the actual submission order.
    var sequence = 0
    form.on('fileBegin', function(name, file) {
      file.submissionSequence = sequence++
      if (/\.aab$/.test(file.originalFilename as string)) {
        file.isAab = true
      }
      var md5 = crypto.createHash('md5')
      file.originalFilename = md5.update(file.originalFilename as string).digest('hex')
    })
    Promise.promisify<
      [Formidable.Fields, Formidable.Files], http.IncomingMessage
    >(form.parse, {context: form, multiArgs: true})(req)
      .spread(function(
        fields: Formidable.Fields | Formidable.Files
      , files: Formidable.Fields | Formidable.Files
      ) {
        return Object.keys(files).map(function(field) {
          var uploaded = (files as Formidable.Files)[field]!.reduce(function(latest, candidate) {
            return candidate.submissionSequence! > latest.submissionSequence! ?
              candidate : latest
          })
          var file = {
            name: uploaded.originalFilename
          , path: uploaded.filepath
          , type: uploaded.mimetype
          , isAab: uploaded.isAab
          }
          log.info('Uploaded "%s" to "%s"', file.name, file.path)
          return {
            field: field
          , id: storage.store(file)
          , name: file.name
          , path: file.path
          , isAab: file.isAab
          }
        })
      })
      .then(function(storedFiles) {
        return Promise.all(storedFiles.map(function(file) {
            return bundletool({
              bundletoolPath: options.bundletoolPath
            , keystore: options.keystore
            , file: file
            })
          })
        )
      })
      .then(function(storedFiles) {
        res.status(201)
          .json({
            success: true
          , resources: (function() {
              var mapped = Object.create(null)
              storedFiles.forEach(function(file) {
                var plugin = req.params.plugin
                mapped[file.field] = {
                  date: new Date()
                , plugin: plugin
                , id: file.id
                , name: file.name
                , href: util.format(
                    '/s/%s/%s%s'
                  , plugin
                  , file.id
                  , file.name ?
                      util.format('/%s', path.basename(file.name)) :
                      ''
                  )
                }
              })
              return mapped
            })()
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
    var file = storage.retrieve(req.params.id)
    if (file) {
      if (typeof req.query.download !== 'undefined') {
        res.set('Content-Disposition',
          'attachment; filename="' + path.basename(file.name as string) + '"')
      }
      res.set('Content-Type', file.type as string)
      res.sendFile(file.path)
    }
    else {
      res.sendStatus(404)
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
