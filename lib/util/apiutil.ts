/**
* Copyright © 2019-2014 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import Promise from 'bluebird'
import _ from 'lodash'
import logger from './logger.js'
import datautil from './datautil.js'
import type deviceutil from './deviceutil.js'
import type {Response} from 'express'
import type {WriteResult} from 'rethinkdb'
import type {GroupDates} from '../types/stf.js'

interface SwaggerParameter<T = unknown> {
  value: T
}

interface SwaggerRequest {
  swagger: {
    params: {[name: string]: SwaggerParameter}
  }
  user: deviceutil.Viewer
}

type RequestBody = {[name: string]: unknown}

interface LockStats {
  replaced?: number
  skipped?: number
  locked?: boolean
}

interface LockResult<S> {
  status: boolean
  data: S & {locked: boolean}
}

interface RetryResult {
  status?: boolean
  data?: unknown
}

interface LockHolder {
  device?: {serial: string}
  user?: {email: string}
  group?: {id: string}
}

interface DurationGroup {
  devices: string[]
  dates: GroupDates[]
  repetitions: number
}

interface ApiUtil {
  PENDING: 'pending'
  READY: 'ready'
  WAITING: 'waiting'
  BOOKABLE: 'bookable'
  STANDARD: 'standard'
  ONCE: 'once'
  DEBUG: 'debug'
  ORIGIN: 'origin'
  STANDARDIZABLE: 'standardizable'
  ROOT: 'root'
  ADMIN: 'admin'
  USER: 'user'
  FIVE_MN: number
  ONE_HOUR: number
  ONE_DAY: number
  ONE_WEEK: number
  ONE_MONTH: number
  ONE_QUATER: number
  ONE_HALF_YEAR: number
  ONE_YEAR: number
  MAX_USER_GROUPS_NUMBER: number
  MAX_USER_GROUPS_DURATION: number
  MAX_USER_GROUPS_REPETITIONS: number
  CLASS_DURATION: {[groupClass: string]: number}
  isOriginGroup(_class: string): boolean
  isAdminGroup(_class: string): boolean
  internalError(res: Response, ...args: unknown[]): void
  respond(res: Response, code: number, message?: string, data?: RequestBody): boolean
  publishGroup<G extends {createdAt?: unknown, ticket?: unknown}>(group: G): G
  publishDevice<D extends datautil.Device>(device: D, user: deviceutil.Viewer): D
  publishUser<U>(user: U): U
  publishAccessToken<T extends {email?: string, jwt?: string}>(token: T): T
  filterDevice<D extends datautil.Device>(req: SwaggerRequest, device: D): D | Partial<D>
  computeDuration(group: DurationGroup, deviceNumber: number): number
  lightComputeStats(res: Response, stats: LockStats): Promise<never> | 'not found'
  computeStats(
    res: Response
  , stats: WriteResult & LockStats
  , objectName: keyof LockHolder
  , ...lock: LockHolder[]
  ): boolean
  lockResult<S extends LockStats>(stats: S): LockResult<S>
  lockDeviceResult<S extends LockStats>(
    stats: S
  , fn: (groups: string[], serial: string) => PromiseLike<unknown[]>
  , groups: string[]
  , serial: string
  ): LockResult<S> | PromiseLike<LockResult<S>>
  setIntervalWrapper<R extends RetryResult>(
    fn: () => Promise<R>
  , numTimes: number
  , delay: number
  ): Promise<R['data']>
  redirectApiWrapper<R extends SwaggerRequest & {body?: RequestBody}, S extends Response>(
    field: string
  , fn: (req: R, res: S) => unknown
  , req: R
  , res: S
  ): void
  computeGroupDates(lifeTime: GroupDates, _class: string, repetitions: number): GroupDates[]
  checkBodyParameter(body: RequestBody | undefined, parameter: string): boolean
  getBodyParameter<T>(body: {[name: string]: T} | undefined, parameter: string): T | undefined
  checkQueryParameter(parameter: SwaggerParameter | undefined): boolean
  getQueryParameter<T>(parameter: SwaggerParameter<T> | undefined): T | undefined
}

const apiutil: ApiUtil = Object.create(null)
const log = logger.createLogger('api:controllers:apiutil')

apiutil.PENDING = 'pending'
apiutil.READY = 'ready'
apiutil.WAITING = 'waiting'

apiutil.BOOKABLE = 'bookable'
apiutil.STANDARD = 'standard'
apiutil.ONCE = 'once'
apiutil.DEBUG = 'debug'
apiutil.ORIGIN = 'origin'
apiutil.STANDARDIZABLE = 'standardizable'

apiutil.ROOT = 'root'
apiutil.ADMIN = 'admin'
apiutil.USER = 'user'

apiutil.FIVE_MN = 300 * 1000
apiutil.ONE_HOUR = 3600 * 1000
apiutil.ONE_DAY = 24 * apiutil.ONE_HOUR
apiutil.ONE_WEEK = 7 * apiutil.ONE_DAY
apiutil.ONE_MONTH = 30 * apiutil.ONE_DAY
apiutil.ONE_QUATER = 3 * apiutil.ONE_MONTH
apiutil.ONE_HALF_YEAR = 6 * apiutil.ONE_MONTH
apiutil.ONE_YEAR = 365 * apiutil.ONE_DAY

apiutil.MAX_USER_GROUPS_NUMBER = 5
apiutil.MAX_USER_GROUPS_DURATION = 15 * apiutil.ONE_DAY
apiutil.MAX_USER_GROUPS_REPETITIONS = 10

apiutil.CLASS_DURATION = {
  once: Infinity
, bookable: Infinity
, standard: Infinity
, hourly: apiutil.ONE_HOUR
, daily: apiutil.ONE_DAY
, weekly: apiutil.ONE_WEEK
, monthly: apiutil.ONE_MONTH
, quaterly: apiutil.ONE_QUATER
, halfyearly: apiutil.ONE_HALF_YEAR
, yearly: apiutil.ONE_YEAR
, debug: apiutil.FIVE_MN
}

apiutil.isOriginGroup = function(_class: string) {
  return _class === apiutil.BOOKABLE || _class === apiutil.STANDARD
}

apiutil.isAdminGroup = function(_class: string) {
  return apiutil.isOriginGroup(_class) || _class === apiutil.DEBUG
}

apiutil.internalError = function(res: Response, ...args: unknown[]) {
  log.error.apply(log, args)
  apiutil.respond(res, 500, 'Internal Server Error')
}

apiutil.respond = function(res: Response, code: number, message?: string, data?: RequestBody) {
  const status = code >= 200 && code < 300
  const response: RequestBody = {
    success: status
  , description: message
  }

  if (data) {
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        response[key] = data[key]
      }
    }
  }
  res.status(code).json(response)
  return status
}

apiutil.publishGroup = function<G extends {createdAt?: unknown, ticket?: unknown}>(group: G) {
//  delete group.lock
  delete group.createdAt
  delete group.ticket
  return group
}

apiutil.publishDevice = function<D extends datautil.Device>(device: D, user: deviceutil.Viewer) {
  datautil.normalize(device, user)
//  delete device.group.lock
  return device
}

apiutil.publishUser = function<U>(user: U) {
//  delete user.groups.lock
  return user
}

apiutil.publishAccessToken = function<T extends {email?: string, jwt?: string}>(token: T) {
  delete token.email
  delete token.jwt
  return token
}

apiutil.filterDevice = function<D extends datautil.Device>(req: SwaggerRequest, device: D) {
  const fields = req.swagger.params.fields!.value as string | undefined

  if (fields) {
    return _.pick(apiutil.publishDevice(device, req.user), fields.split(','))
  }
  return apiutil.publishDevice(device, req.user)
}

apiutil.computeDuration = function(group: DurationGroup, deviceNumber: number) {
  return (group.devices.length + deviceNumber) *
         ((group.dates[0]!.stop as unknown as number) - (group.dates[0]!.start as unknown as
           number)) *
         (group.repetitions + 1)
}

apiutil.lightComputeStats = function(res: Response, stats: LockStats) {
  if (stats.locked) {
    apiutil.respond(res, 503, 'Server too busy, please try again later')
    return Promise.reject('busy')
  }
  return 'not found'
}

apiutil.computeStats = function(
  res: Response
, stats: WriteResult & LockStats
, objectName: keyof LockHolder
, ...lock: LockHolder[]
) {
  if (!stats.replaced) {
    if (stats.skipped) {
      return apiutil.respond(res, 404, `Not Found (${objectName})`)
    }
    if (stats.locked) {
      return apiutil.respond(res, 503, 'Server too busy, please try again later')
    }
    return apiutil.respond(res, 403, `Forbidden (${objectName})`)
  }
  if (lock.length) {
    lock[0]![objectName] = stats.changes![0]!.new_val
  }
  return true
}

apiutil.lockResult = function<S extends LockStats>(stats: S) {
  const result: LockResult<S> = {status: false, data: stats as S & {locked: boolean}}

  if (stats.replaced || stats.skipped) {
    result.status = true
    result.data.locked = false
  }
  else {
    result.data.locked = true
  }
  return result
}

apiutil.lockDeviceResult = function<S extends LockStats>(
  stats: S
, fn: (groups: string[], serial: string) => PromiseLike<unknown[]>
, groups: string[]
, serial: string
) {
  const result = apiutil.lockResult(stats)
  if (!result.status) {
    return fn(groups, serial).then(function(devices) {
      if (!devices.length) {
        result.data.locked = false
        result.status = true
      }
      return result
    })
  }
  return result
}

apiutil.setIntervalWrapper = function<R extends RetryResult>(
  fn: () => Promise<R>
, numTimes: number
, delay: number
) {
  return fn().then(function(result) {
    if (result.status) {
      return result.data
    }
    return new Promise<R['data']>(function(resolve, reject) {
      let counter = 0
      const interval = setInterval(function() {
        return fn().then(function(result) {
          if (result.status || ++counter === numTimes) {
            if (!result.status && counter === numTimes) {
              log.warn('%s() failed %s times in a loop!', fn.name, counter)
            }
            clearInterval(interval)
            resolve(result.data)
          }
        })
        .catch(function(err) {
          clearInterval(interval)
          reject(err)
        })
      }, delay)
    })
 })
}

apiutil.redirectApiWrapper = function<
  R extends SwaggerRequest & {body?: RequestBody}
, S extends Response
>(field: string, fn: (req: R, res: S) => unknown, req: R, res: S) {
  if (typeof req.body === 'undefined') {
    req.body = {}
  }
  req.body[field + 's'] = req.swagger.params[field]!.value
  req.swagger.params.redirected = {value: true}
  fn(req, res)
}

apiutil.computeGroupDates = function(lifeTime: GroupDates, _class: string, repetitions: number) {
  const dates = new Array(lifeTime)

  for(let repetition = 1
      , currentLifeTime = {
          start: new Date(lifeTime.start.getTime())
        , stop: new Date(lifeTime.stop.getTime())
        }
      ; repetition <= repetitions
      ; repetition++) {
    currentLifeTime.start = new Date(
      currentLifeTime.start.getTime() +
      apiutil.CLASS_DURATION[_class]!
    )
    currentLifeTime.stop = new Date(
      currentLifeTime.stop.getTime() +
      apiutil.CLASS_DURATION[_class]!
    )
    dates.push({
      start: new Date(currentLifeTime.start.getTime())
    , stop: new Date(currentLifeTime.stop.getTime())
    })
  }
  return dates
}

apiutil.checkBodyParameter = function(body: RequestBody | undefined, parameter: string) {
  return typeof body !== 'undefined' && typeof body[parameter] !== 'undefined'
}

apiutil.getBodyParameter = function<T>(body: {[name: string]: T} | undefined, parameter: string) {
  let undef: undefined

  return apiutil.checkBodyParameter(body, parameter) ? body![parameter] : undef
}

apiutil.checkQueryParameter = function(parameter: SwaggerParameter | undefined) {
  return typeof parameter !== 'undefined' && typeof parameter.value !== 'undefined'
}

apiutil.getQueryParameter = function<T>(parameter: SwaggerParameter<T> | undefined) {
  let undef: undefined

  return apiutil.checkQueryParameter(parameter) ? parameter!.value : undef
}

namespace apiutil {
  export type Parameter<T = unknown> = SwaggerParameter<T>
  export type Request = SwaggerRequest
  export type Body = RequestBody
  export type Stats = LockStats
  export type Lock<S> = LockResult<S>
  export type Holder = LockHolder
}

export default apiutil
