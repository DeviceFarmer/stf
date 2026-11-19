import http from 'node:http'
import crypto from 'node:crypto'
import type {AddressInfo} from 'node:net'

import {expect} from 'chai'

import simchange from '../../lib/util/simchange.js'
import type {SimChangeSource} from '../../lib/util/simchange.js'

function makeSource(phone?: {iccid?: string, imsi?: string, imei?: string}):
  SimChangeSource {
  return {
    serial: 'TA93003ELZ8'
  , model: 'Pixel 8'
  , manufacturer: 'Google'
  , phone: phone || null
  }
}

describe('simchange', function() {
  describe('buildSimChangeEvent', function() {
    it('should not report an event when the ICCID is unchanged', function() {
      expect(simchange.buildSimChangeEvent(
        makeSource({iccid: 'one'})
      , makeSource({iccid: 'one'})
      )).to.equal(null)
    })

    it('should not report an event without any ICCID', function() {
      expect(simchange.buildSimChangeEvent(
        makeSource()
      , makeSource()
      )).to.equal(null)
    })

    it('should treat an empty ICCID as no SIM card', function() {
      expect(simchange.buildSimChangeEvent(
        makeSource({iccid: ''})
      , makeSource()
      )).to.equal(null)
    })

    it('should report an inserted SIM card', function() {
      var event = simchange.buildSimChangeEvent(
        makeSource()
      , makeSource({iccid: '8944012345678'})
      )
      expect(event && event.change).to.equal('inserted')
      expect(event && event.previous.iccid).to.equal(null)
      expect(event && event.current.iccid).to.equal('8944012345678')
    })

    it('should report a removed SIM card', function() {
      var event = simchange.buildSimChangeEvent(
        makeSource({iccid: '8944012345678'})
      , makeSource()
      )
      expect(event && event.change).to.equal('removed')
      expect(event && event.previous.iccid).to.equal('8944012345678')
      expect(event && event.current.iccid).to.equal(null)
    })

    it('should report a replaced SIM card', function() {
      var event = simchange.buildSimChangeEvent(
        makeSource({iccid: '8944012345678'})
      , makeSource({iccid: '8944087654321'})
      )
      expect(event && event.change).to.equal('replaced')
      expect(event && event.previous.iccid).to.equal('8944012345678')
      expect(event && event.current.iccid).to.equal('8944087654321')
    })

    it('should treat a missing device as no previous SIM card', function() {
      var event = simchange.buildSimChangeEvent(
        null
      , makeSource({iccid: '8944012345678', imsi: '310260000000000'})
      )
      expect(event && event.change).to.equal('inserted')
      expect(event && event.previous.iccid).to.equal(null)
    })

    it('should fill the event with the device and SIM card state',
      function() {
        var event = simchange.buildSimChangeEvent(
          makeSource({iccid: '8944012345678', imsi: '310260000000000'})
        , makeSource({iccid: '8944087654321', imsi: '310260111111111'
          , imei: '867400022047199'})
        )
        expect(event && event.event).to.equal('sim.changed')
        expect(event && event.serial).to.equal('TA93003ELZ8')
        expect(event && event.model).to.equal('Pixel 8')
        expect(event && event.manufacturer).to.equal('Google')
        expect(event && event.previous).to.deep.equal({
          iccid: '8944012345678'
        , imsi: '310260000000000'
        , imei: null
        })
        expect(event && event.current).to.deep.equal({
          iccid: '8944087654321'
        , imsi: '310260111111111'
        , imei: '867400022047199'
        })
        expect(event && event.timestamp).to.be.a('string')
      })
  })

  describe('sendSimChangeEvent', function() {
    interface CapturedRequest {
      method: string | undefined
    , url: string | undefined
    , headers: http.IncomingHttpHeaders
    , body: string
    }

    var server = http.createServer()
    var requests: CapturedRequest[] = []
    var respond: http.RequestListener = function(req, res) {
      res.end()
    }

    before(async function() {
      server.on('request', function(req, res) {
        var chunks: Buffer[] = []
        req.on('data', function(chunk) {
          chunks.push(chunk)
        })
        req.on('end', function() {
          requests.push({
            method: req.method
          , url: req.url
          , headers: req.headers
          , body: Buffer.concat(chunks).toString('utf8')
          })
          respond(req, res)
        })
      })
      await new Promise<void>(function(resolve) {
        server.listen(0, '127.0.0.1', resolve)
      })
    })

    after(async function() {
      await new Promise(function(resolve) {
        server.close(resolve)
      })
    })

    beforeEach(function() {
      requests = []
      respond = function(req, res) {
        res.end()
      }
    })

    var hookUrl = function() {
      return 'http://127.0.0.1:' + (server.address() as AddressInfo).port +
        '/hook'
    }

    var makeEvent = function() {
      return simchange.buildSimChangeEvent(
        makeSource({iccid: '8944012345678'})
      , makeSource({iccid: '8944087654321'})
      )
    }

    it('should POST the event as signed JSON', async function() {
      var event = makeEvent()!
      await simchange.sendSimChangeEvent(hookUrl(), 'sekret', event
      , {retryDelay: 1}
      )

      expect(requests).to.have.length(1)
      var captured = requests[0]!
      expect(captured.method).to.equal('POST')
      expect(captured.url).to.equal('/hook')
      expect(captured.headers['content-type']).to.equal('application/json')
      expect(captured.headers['x-stf-event']).to.equal('sim.changed')

      var sent = JSON.parse(captured.body)
      expect(sent.event).to.equal('sim.changed')
      expect(sent.change).to.equal('replaced')
      expect(sent.serial).to.equal('TA93003ELZ8')
      expect(sent.current.iccid).to.equal('8944087654321')

      var signature = 'sha256=' + crypto.createHmac('sha256', 'sekret')
        .update(captured.body).digest('hex')
      expect(captured.headers['x-stf-signature']).to.equal(signature)
    })

    it('should not sign the event without a secret', async function() {
      var event = makeEvent()!
      await simchange.sendSimChangeEvent(hookUrl(), '', event, {retryDelay: 1})

      expect(requests).to.have.length(1)
      expect(requests[0]!.headers).to.not.have.property('x-stf-signature')
    })

    it('should retry a failing webhook and then give up', async function() {
      respond = function(req, res) {
        res.statusCode = 500
        res.end()
      }

      var failed = false
      await simchange.sendSimChangeEvent(hookUrl(), '', makeEvent()!
      , {attempts: 2, retryDelay: 1}
      ).catch(function() {
        failed = true
      })

      expect(failed).to.equal(true)
      expect(requests).to.have.length(2)
    })

    it('should stop retrying once the webhook succeeds', async function() {
      var calls = 0
      respond = function(req, res) {
        calls += 1
        res.statusCode = calls === 1 ? 500 : 200
        res.end()
      }

      await simchange.sendSimChangeEvent(hookUrl(), '', makeEvent()!
      , {attempts: 3, retryDelay: 1}
      )

      expect(requests).to.have.length(2)
    })
  })
})
