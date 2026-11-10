import type http from 'node:http'
import express from 'express'
import type {ErrorRequestHandler} from 'express'
import {WebSocketServer, createWebSocketStream} from 'ws'
import {CoordinatorAccess, type Principal} from './access.js'
import {LeaseAdbBridge} from './adb-bridge.js'
import {CoordinatorError} from './config.js'
import {validMaintenanceId, validMaintenanceSerial} from './maintenance.js'
import {Coordinator} from './engine.js'
import type {AllocationInput, CoordinatorOptions, CaptureReconciliationInput} from './types.js'

function allocation(body: unknown, options: CoordinatorOptions): AllocationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CoordinatorError(400, 'invalid_request', 'Expected a JSON allocation request')
  }
  const value = body as Record<string, unknown>
  const keys = ['runId', 'runner', 'platform', 'serial', 'model', 'provider', 'queueTimeoutSeconds'
    , 'maxDurationSeconds']
  if (Object.keys(value).some(key => !keys.includes(key)) ||
      (value.platform !== 'Android' && value.platform !== 'iOS') ||
      (value.runner !== undefined && value.runner !== 'appium' && value.runner !== 'maestro')) {
    throw new CoordinatorError(400, 'invalid_request', 'Unknown field or unsupported platform')
  }
  for (const key of ['runId', 'serial', 'model', 'provider']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' ||
        !(value[key] as string).trim() || (value[key] as string).length > 256)) {
      throw new CoordinatorError(400, 'invalid_request', 'Invalid allocation string field')
    }
  }
  if (!value.runId) {
    throw new CoordinatorError(400, 'invalid_request', 'runId is required')
  }
  const integer = (key: string, fallback: number) => {
    const number = value[key] ?? fallback
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 ||
        number > 86400) {
      throw new CoordinatorError(400, 'invalid_request', 'Invalid allocation timeout')
    }
    return number
  }
  const input: AllocationInput = {
    runId: value.runId as string, platform: value.platform
  , queueTimeoutSeconds: integer('queueTimeoutSeconds', 3600)
  , maxDurationSeconds: integer('maxDurationSeconds', options.maxDurationSeconds)
  }
  if (value.runner !== undefined) {
    input.runner = value.runner
  }
  if (input.maxDurationSeconds > options.maxDurationSeconds) {
    throw new CoordinatorError(400, 'duration_limit',
      'Requested duration exceeds coordinator limit')
  }
  for (const key of ['serial', 'model', 'provider'] as const) {
    if (value[key] !== undefined) {
      input[key] = value[key] as string
    }
  }
  return input
}

function recovery(body: unknown, operator: Principal): CaptureReconciliationInput | undefined {
  if (body === undefined) {
    return undefined
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CoordinatorError(400, 'invalid_reconciliation', 'Expected a recovery object')
  }
  const value = body as Record<string, unknown>
  if (Object.keys(value).length === 0) {
    return undefined
  }
  const keys = ['reconcileUnowned', 'serial', 'captureTransportRetired', 'reason']
  if (Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      value.reconcileUnowned !== true || value.captureTransportRetired !== true ||
      typeof value.serial !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value.serial) ||
      typeof value.reason !== 'string' || !value.reason.trim() ||
      value.reason.length > 1024 || value.reason !== value.reason.trim() ||
      value.reason.split('').some(character =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new CoordinatorError(400, 'invalid_reconciliation',
      'Reconciliation requires the exact serial, retired capture transport and an operator reason')
  }
  return {serial: value.serial, captureTransportRetired: true, reason: value.reason
    , actor: 'operator', projectId: operator.projectId}
}

export function createCoordinatorApp(engine: Coordinator, credential: string | CoordinatorAccess) {
  const access = typeof credential === 'string' ? new CoordinatorAccess(credential) : credential
  engine.setProjectLimits(access.limits())
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.get('/healthz', (_req, res) => res.json({healthy: true}))
  app.get('/readyz', (_req, res) => res.status(engine.ready ? 200 : 503)
    .json({ready: engine.ready}))
  app.use('/api/v1', (req, res, next) => {
    const principal = access.authenticate(req.headers.authorization)
    if (!principal) {
      res.setHeader('WWW-Authenticate', 'Basic realm="STF coordinator"')
      res.status(401).json({error: {code: 'unauthorized', message: 'Authentication required'}})
      return
    }
    res.locals.principal = principal
    next()
  })
  app.use(express.json({limit: '1mb', strict: true}))
  const principal = (res: express.Response) => res.locals.principal as Principal
  const scopeLease = (id: string, res: express.Response) =>
    access.assertProject(principal(res), engine.leaseProject(id), 'lease')
  const scopeRequest = (id: string, res: express.Response) =>
    access.assertProject(principal(res), engine.requestProject(id), 'request')
  app.get('/api/v1/status', (_req, res) => res.json(engine.status(
    principal(res).admin ? undefined : principal(res).projectId)))
  app.post('/api/v1/maintenance', async(req, res) => {
    access.assertAdmin(principal(res))
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['serial', 'operationId'].includes(key)) ||
        !validMaintenanceSerial(body.serial) || !validMaintenanceId(body.operationId)) {
      throw new CoordinatorError(400, 'invalid_maintenance',
        'Expected a serial and operation UUID')
    }
    const maintenance = await engine.startMaintenance(body.serial, body.operationId)
    res.status(202).json({maintenance})
  })
  app.get('/api/v1/maintenance/:id', (req, res) => {
    access.assertAdmin(principal(res))
    res.json({maintenance: engine.maintenanceView(req.params.id)})
  })
  app.delete('/api/v1/maintenance/:id', async(req, res) => {
    access.assertAdmin(principal(res))
    res.json({maintenance: await engine.finishMaintenance(req.params.id)})
  })
  app.post('/api/v1/requests', async(req, res) => {
    const key = req.header('Idempotency-Key')
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key)) {
      throw new CoordinatorError(400, 'idempotency_required', 'Idempotency-Key is required')
    }
    const request = await engine.submit(allocation(req.body, engine.options), key,
      principal(res).projectId)
    res.status(202).json({request})
  })
  app.get('/api/v1/requests/:id', (req, res) => {
    scopeRequest(req.params.id, res)
    res.json({request: engine.requestView(req.params.id)})
  })
  app.delete('/api/v1/requests/:id', async(req, res) => {
    scopeRequest(req.params.id, res)
    res.status(202).json({request: await engine.cancel(req.params.id)})
  })
  app.get('/api/v1/leases', (_req, res) => res.json({leases: engine.leasesView(
    principal(res).admin ? undefined : principal(res).projectId)}))
  app.get('/api/v1/leases/:id', (req, res) => {
    scopeLease(req.params.id, res)
    res.json({lease: engine.leaseView(req.params.id)})
  })
  app.post('/api/v1/leases/:id/renew', async(req, res) => {
    scopeLease(req.params.id, res)
    res.json({lease: await engine.renew(req.params.id)})
  })
  app.delete('/api/v1/leases/:id', async(req, res) => {
    scopeLease(req.params.id, res)
    res.status(202).json({lease: await engine.release(req.params.id)})
  })
  app.post('/api/v1/leases/:id/recover', async(req, res) => {
    access.assertAdmin(principal(res))
    scopeLease(req.params.id, res)
    const input = recovery(req.body, principal(res))
    res.status(202).json({lease: await engine.recover(req.params.id, input)})
  })
  app.use('/api/v1/leases/:id/webdriver', async(req, res) => {
    scopeLease(String(req.params.id), res)
    const route = req.url.split('?')[0] || ''
    const parts = route.split('/').slice(1).map(part => decodeURIComponent(part))
    if (req.url.includes('?') || parts.some(part => part === '.' || part === '..' ||
        part.includes('%') ||
        part.includes('/') || part.includes('\\') ||
        [...part].some(character => character.charCodeAt(0) <= 32))) {
      throw new CoordinatorError(400, 'invalid_webdriver_path', 'Invalid WebDriver path')
    }
    const response = await engine.webdriver(String(req.params.id), req.method, route, req.body)
    res.status(response.status).type(response.contentType).send(response.body)
  })
  app.use((_req, res) => res.status(404)
    .json({error: {code: 'not_found', message: 'Route not found'}}))
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    const known = error instanceof CoordinatorError
    let status = 500
    let code = 'internal_error'
    let message = 'Coordinator operation failed'
    if (known) {
      status = error.status
      code = error.code
      message = error.message
    }
    else if (error instanceof URIError || error instanceof SyntaxError) {
      status = 400
      code = 'invalid_request'
      message = 'Invalid request'
    }
    if (req.originalUrl.includes('/webdriver/')) {
      res.status(status).json({value: {
        error: status === 404 ? 'invalid session id' : 'unknown error'
      , message, stacktrace: ''}})
    }
    else {
      res.status(status).json({error: {code, message}})
    }
  }
  app.use(errors)
  return app
}

/** Every smart-socket connection is authenticated and pinned to one live project lease. */
export function attachCoordinatorAdb(server: http.Server, engine: Coordinator,
  access: CoordinatorAccess) {
  const bridge = new LeaseAdbBridge()
  const sockets = new WebSocketServer({noServer: true, maxPayload: 1024 * 1024
    , perMessageDeflate: false})
  const ownership = new Map<string, {validUntil: number, pending: Promise<void> | null}>()
  engine.setAdbCloser(id => {
    ownership.delete(id)
    bridge.closeLease(id)
  })
  async function assertOwner(id: string, refresh = false) {
    engine.assertAdbActive(id)
    let check = ownership.get(id)
    if (!check) {
      check = {validUntil: 0, pending: null}
      ownership.set(id, check)
    }
    if (!check.pending && (refresh || check.validUntil <= performance.now())) {
      const validUntil = performance.now() + 1000
      const entry = check
      entry.pending = engine.authorizeAdb(id).then(() => {
        entry.validUntil = validUntil
      }).finally(() => {
        entry.pending = null
      })
    }
    await check.pending
    engine.assertAdbActive(id)
    if (check.validUntil <= performance.now()) {
      throw new CoordinatorError(503, 'adb_ownership_unconfirmed',
        'STF ownership check was too slow')
    }
  }
  server.on('upgrade', async(req, socket, head) => {
    try {
      const match = /^\/api\/v1\/leases\/([A-Za-z0-9_-]{1,128})\/adb$/.exec(req.url || '')
      const identity = access.authenticate(req.headers.authorization)
      if (!identity) {
 throw new CoordinatorError(401, 'unauthorized', 'Authentication required')
}
      if (!match) {
 throw new CoordinatorError(404, 'not_found', 'Route not found')
}
      const id = match[1]!
      access.assertProject(identity, engine.leaseProject(id), 'lease')
      await assertOwner(id, true)
      const target = engine.adbTarget(id)
      sockets.handleUpgrade(req, socket, head, ws => {
        ws.on('error', () => {})
        ws.on('message', (_data, binary) => {
 if (!binary) {
 ws.close(1003, 'Binary data required')
}
})
        const stream = createWebSocketStream(ws)
        // ws streams disable autoDestroy. A closed WebSocket must release its duplex
        // even when metadata reads leave the readable side paused at EOF.
        ws.once('close', () => stream.destroy())
        // A normal smart-socket EOF has an explicit close code. Destroy/revocation
        // continues to terminate the WebSocket, so the worker stops its test.
        stream._final = done => {
          if (ws.readyState === ws.CLOSED) {
 done()
}
          else {
            ws.once('close', () => done())
            ws.close(1000)
          }
        }
        bridge.accept(stream, target, fresh => assertOwner(id, fresh))
      })
    }
    catch (error) {
      const status = error instanceof CoordinatorError ? error.status : 500
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    }
  })
  return {close() {
    bridge.close()
    ownership.clear()
    for (const ws of sockets.clients) {
 ws.terminate()
}
    sockets.close()
  }}
}
