/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var http = require('http')
var util = require('util')
var path = require('path')
var fs = require('fs')
var crypto = require('crypto')

var express = require('express')
var bodyParser = require('body-parser')
var formidable = require('formidable')
var Promise = require('bluebird')
var uuid = require('uuid')
var s3sdk = require('@aws-sdk/client-s3')
var credentialProviders = require('@aws-sdk/credential-providers')

var logger = require('../../util/logger')
var download = require('../../util/download')
var requtil = require('../../util/requtil')

module.exports = function(options) {
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

  function putObject(plugin, file) {
    var id = uuid.v4()

    return Promise.promisify(fs.stat, fs)(file.path)
      .then(function(stat) {
        return s3.send(new s3sdk.PutObjectCommand({
          Key: id
        , Body: fs.createReadStream(file.path)
        , ContentLength: stat.size
        , Bucket: options.bucket
        , Metadata: {
            plugin: plugin
          , name: file.name
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

  function getHref(plugin, id, name) {
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
    Promise.promisify(form.parse, {context: form, multiArgs: true})(req)
      .spread(function(fields, files) {
        var requests = Object.keys(files).map(function(field) {
          var uploaded = files[field][files[field].length - 1]
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
    function(req, res) {
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
          return Promise.promisify(fs.unlink, fs)(file.temppath)
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
        data.Body.pipe(res)
      })
      .catch(function(err) {
        log.error('Unable to retrieve "%s"', req.params.id, err.stack)
        res.sendStatus(404)
      })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
