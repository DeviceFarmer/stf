import crypto from 'crypto'
import http from 'http'
import https from 'https'
import util from 'util'

import Promise from 'bluebird'
import type {OutgoingHttpHeaders} from 'http'

export interface SimChangePhoneFields {
  iccid?: string | null
, imsi?: string | null
, imei?: string | null
}

export interface SimCardState {
  iccid: string | null
, imsi: string | null
, imei: string | null
}

export interface SimChangeEvent {
  event: 'sim.changed'
, change: 'inserted' | 'removed' | 'replaced'
, serial: string
, model: string | null
, manufacturer: string | null
, previous: SimCardState
, current: SimCardState
, timestamp: string
}

// Anything able to report a device's phone state: the device document from
// the database and the incoming identity message both qualify.
export interface SimChangeSource {
  serial: string
, model?: string | null
, manufacturer?: string | null
, phone?: SimChangePhoneFields | null
}

export interface SimChangeSendOptions {
  attempts?: number
, retryDelay?: number
, timeout?: number
}

interface SimChange {
  buildSimChangeEvent(
    previous: SimChangeSource | null
  , current: SimChangeSource
  ): SimChangeEvent | null
  sendSimChangeEvent(
    url: string
  , secret: string
  , event: SimChangeEvent
  , options?: SimChangeSendOptions
  ): Promise<void>
}

var simchange: SimChange = Object.create(null)

var ATTEMPTS = 3
var RETRY_DELAY = 1000
var TIMEOUT = 10000
var SIGNATURE_HEADER = 'x-stf-signature'

function normalize(value?: string | null) {
  return value || null
}

function readSimCardState(phone?: SimChangePhoneFields | null): SimCardState {
  return {
    iccid: normalize(phone && phone.iccid)
  , imsi: normalize(phone && phone.imsi)
  , imei: normalize(phone && phone.imei)
  }
}

function classifyChange(
  previousIccid: string | null
, currentIccid: string | null
): SimChangeEvent['change'] {
  if (!previousIccid) {
    return 'inserted'
  }
  if (!currentIccid) {
    return 'removed'
  }
  return 'replaced'
}

simchange.buildSimChangeEvent = function(previous, current) {
  var previousState = readSimCardState(previous && previous.phone)
  var currentState = readSimCardState(current.phone)

  if (previousState.iccid === currentState.iccid) {
    return null
  }

  return {
    event: 'sim.changed'
  , change: classifyChange(previousState.iccid, currentState.iccid)
  , serial: current.serial
  , model: normalize(current.model)
  , manufacturer: normalize(current.manufacturer)
  , previous: previousState
  , current: currentState
  , timestamp: new Date().toISOString()
  }
}

function post(
  url: string
, headers: OutgoingHttpHeaders
, body: Buffer
, timeout: number
): Promise<void> {
  return new Promise(function(resolve, reject) {
    var target = new URL(url)

    function onResponse(response: http.IncomingMessage) {
      response.resume()
      if (response.statusCode && response.statusCode >= 200 &&
          response.statusCode < 300) {
        resolve()
      }
      else {
        reject(new Error(util.format(
          'Webhook responded with status %s'
        , response.statusCode
        )))
      }
    }

    var request = target.protocol === 'https:' ?
      https.request(target, {method: 'POST', headers: headers}, onResponse) :
      http.request(target, {method: 'POST', headers: headers}, onResponse)

    request.on('error', reject)
    request.setTimeout(timeout, function() {
      request.destroy(new Error('Webhook request timed out'))
    })
    request.end(body)
  })
}

simchange.sendSimChangeEvent = function(url, secret, event, options) {
  var attempts = options && typeof options.attempts === 'number' ?
    options.attempts : ATTEMPTS
  var retryDelay = options && typeof options.retryDelay === 'number' ?
    options.retryDelay : RETRY_DELAY
  var timeout = options && typeof options.timeout === 'number' ?
    options.timeout : TIMEOUT

  var body = Buffer.from(JSON.stringify(event))
  var headers: OutgoingHttpHeaders = {
    'Content-Type': 'application/json'
  , 'Content-Length': body.length
  , 'X-STF-Event': event.event
  }
  if (secret) {
    headers[SIGNATURE_HEADER] = util.format('sha256=%s'
    , crypto.createHmac('sha256', secret).update(body).digest('hex')
    )
  }

  function attempt(attemptsLeft: number): Promise<void> {
    return post(url, headers, body, timeout)
      .catch(function(err) {
        if (attemptsLeft > 1) {
          return Promise.delay(retryDelay).then(function() {
            return attempt(attemptsLeft - 1)
          })
        }
        throw err
      })
  }

  return attempt(attempts)
}

export default simchange
