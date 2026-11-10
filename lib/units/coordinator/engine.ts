import {createHash, randomUUID} from 'node:crypto'
import {setTimeout as wait} from 'node:timers/promises'
import {BackendError} from './backend.js'
import {CoordinatorError, endpoint} from './config.js'
import {validMaintenanceId, validMaintenanceSerial} from './maintenance.js'
import {wdaProfileCovers} from './wda-profile.js'
import type {AdbTarget} from './adb-bridge.js'
import type {StateStore} from './state.js'
import type {
  AdbPool, AllocationInput, AllocationRequest, CaptureReconciliationInput, CoordinatorOptions
, CoordinatorState, FarmBackend
, FarmDevice, GridStatus, Lease, UpstreamResponse
} from './types.js'

const terminal = new Set(['released', 'expired'])
const requestTerminal = new Set(['cancelled', 'expired', 'failed'])

function matchesAdbRoute(capabilities: Record<string, unknown>, pool: AdbPool) {
  const port = capabilities['appium:adbPort']
  return capabilities['appium:remoteAdbHost'] === pool.host &&
    (typeof port === 'undefined' || port === pool.port)
}

export class Coordinator {
  private state: CoordinatorState = {version: 2, requests: [], leases: [], maintenance: []}
  private queue: Promise<unknown> = Promise.resolve()
  private owner = ''
  private initialized = false
  private stopping = false
  private fault = false
  private lastError: string | null = null
  private readonly renewed = new Map<string, number>()
  private readonly commands = new Map<string, Promise<unknown>>()
  private readonly closingSessions = new Set<string>()
  private readonly allocations = new Map<string, Promise<void>>()
  private readonly cleanups = new Map<string, Promise<void>>()
  private readonly reconciliations = new Map<string, {fingerprint: string
    , operation: Promise<ReturnType<Coordinator['leaseView']>>}>()
  private ticking: Promise<void> | null = null
  private closeAdb: (id: string) => void = () => {}
  private projectLimits = new Map<string, number>()

  constructor(readonly options: CoordinatorOptions, private readonly pools: AdbPool[],
    private readonly backend: FarmBackend, private readonly store: StateStore,
    private readonly now: () => number = Date.now) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  private async save() {
    try {
      await this.store.save(this.state)
    }
    catch {
      this.fault = true
      throw new CoordinatorError(503, 'state_unavailable', 'Persistent state is unavailable')
    }
  }

  private assertReady() {
    if (!this.initialized || this.stopping || this.fault) {
      throw new CoordinatorError(503, 'not_ready', 'Coordinator is not ready')
    }
  }

  private assertAppiumEnabled() {
    if (typeof this.options.appiumGridUrl === 'undefined') {
      throw new CoordinatorError(409, 'runner_disabled',
        'Appium is disabled; configure --appium-grid-url to enable it')
    }
  }

  get ready() {
    return this.initialized && !this.stopping && !this.fault
  }

  get stfTimeoutMs() {
    const grace = 180 + 2 * this.options.upstreamTimeoutSeconds
    return (this.options.leaseTtlSeconds + grace) * 1000
  }

  async start() {
    const state = await this.store.load()
    const maestroOnly = typeof this.options.appiumGridUrl === 'undefined'
    if (maestroOnly && state.leases.some(lease =>
      lease.runner !== 'maestro' && this.held(lease))) {
      throw new CoordinatorError(503, 'appium_state_requires_grid',
        'Persisted Appium leases still require cleanup with the original Appium Grid')
    }
    this.owner = (await this.backend.identity()).email
    this.state = state
    if (maestroOnly) {
      for (const request of this.state.requests) {
        if (request.state === 'queued' && request.input.runner !== 'maestro') {
          request.state = 'failed'
          request.error = 'runner_disabled'
        }
      }
    }
    for (const lease of this.state.leases) {
      if (!terminal.has(lease.state)) {
        lease.state = 'cleaning'
        lease.finishState = 'expired'
        lease.error = 'coordinator_restarted'
      }
    }
    await this.save()
    for (const lease of this.state.leases.filter(item => item.state === 'cleaning')) {
      await this.cleanup(lease)
    }
    this.initialized = true
  }

  setAdbCloser(close: (id: string) => void) {
    this.closeAdb = close
  }

  setProjectLimits(limits: ReadonlyMap<string, number>) {
    this.projectLimits = new Map(limits)
  }

  requestProject(id: string) {
    return this.request(id).projectId || 'legacy'
  }

  leaseProject(id: string) {
    return this.lease(id).projectId || 'legacy'
  }

  assertAdbActive(id: string) {
    const lease = this.lease(id)
    this.assertActive(lease)
    if (lease.runner !== 'maestro') {
      throw new CoordinatorError(409, 'runner_conflict', 'This lease does not use ADB')
    }
  }

  adbTarget(id: string): AdbTarget {
    this.assertAdbActive(id)
    const lease = this.lease(id)
    const pool = this.pools.find(item => item.provider === lease.device.provider)
    if (!pool || lease.device.platform !== 'Android') {
      throw new CoordinatorError(409, 'adb_unavailable', 'The allocated device has no ADB route')
    }
    return {leaseId: lease.id, serial: lease.device.serial, host: pool.host, port: pool.port}
  }

  async authorizeAdb(id: string) {
    this.assertAdbActive(id)
    const lease = this.lease(id)
    // Opening a transport verifies the provider epoch, but does not renew the worker deadline.
    await this.refreshOwnership(lease)
    this.assertAdbActive(id)
    return this.adbTarget(id)
  }

  status(projectId?: string) {
    const count = (items: {state: string}[]) => Object.fromEntries(
      [...new Set(items.map(item => item.state))].map(state => [state
        , items.filter(item => item.state === state).length]))
    const belongs = (item: {projectId?: string}) => !projectId ||
      (item.projectId || 'legacy') === projectId
    return {ready: this.ready, requests: count(this.state.requests.filter(belongs))
    , leases: count(this.state.leases.filter(belongs))
    , lastError: this.lastError}
  }

  private lease(id: string) {
    const lease = this.state.leases.find(item => item.id === id)
    if (!lease) {
      throw new CoordinatorError(404, 'lease_not_found', 'Lease not found')
    }
    return lease
  }

  private request(id: string) {
    const request = this.state.requests.find(item => item.id === id)
    if (!request) {
      throw new CoordinatorError(404, 'request_not_found', 'Request not found')
    }
    return request
  }

  requestView(id: string) {
    const request = this.request(id)
    return {id: request.id, projectId: request.projectId || 'legacy'
    , runId: request.input.runId, state: request.state
    , createdAt: new Date(request.createdAt).toISOString()
    , ...(request.leaseId ? {leaseId: request.leaseId} : {})
    , ...(request.error ? {error: request.error} : {})}
  }

  leaseView(id: string) {
    const lease = this.lease(id)
    const device = lease.device
    const runner = lease.runner || 'appium'
    const path = `/api/v1/leases/${lease.id}/${runner === 'maestro' ? 'adb' : 'webdriver'}`
    const connection = runner === 'maestro' ?
      {type: 'adb' as const, path, serial: device.serial} :
      {type: 'webdriver' as const, path, capabilities: lease.capabilities}
    return {id: lease.id, projectId: lease.projectId || 'legacy'
    , requestId: lease.requestId, runId: lease.runId, runner, state: lease.state
    , connection
    , device: {serial: device.serial, model: device.model, platform: device.platform
      , provider: device.provider, version: device.version}
    , expiresAt: new Date(lease.expiresAt).toISOString()
    , deadlineAt: new Date(lease.deadlineAt).toISOString()
    , heartbeatIntervalSeconds: this.options.heartbeatIntervalSeconds
    , capabilities: lease.capabilities
    , ...(runner === 'appium' ? {webdriverUrl: endpoint(this.options.publicUrl) + path} : {})
    , ...(lease.sessionId ? {sessionId: lease.sessionId} : {})
    , ...(lease.error ? {error: lease.error} : {})
    , ...(lease.captureReconciliation ? {captureReconciliation: {...lease.captureReconciliation
      , at: new Date(lease.captureReconciliation.at).toISOString()}} : {})}
  }

  leasesView(projectId?: string) {
    return this.state.leases.filter(lease => !projectId ||
      (lease.projectId || 'legacy') === projectId).map(lease => this.leaseView(lease.id))
  }

  submit(input: AllocationInput, key: string, projectId = 'legacy') {
    return this.exclusive(async() => {
      this.assertReady()
      if (projectId !== 'legacy' && !this.projectLimits.has(projectId)) {
        throw new CoordinatorError(403, 'project_disabled', 'Project is not enabled')
      }
      if (input.runner === 'maestro' && input.platform !== 'Android') {
        throw new CoordinatorError(400, 'unsupported_runner',
          'Maestro requires physical Android devices')
      }
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      const existing = this.state.requests.find(request => request.key === key &&
        (request.projectId || 'legacy') === projectId)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new CoordinatorError(409, 'idempotency_conflict',
            'Idempotency-Key was already used for a different request')
        }
        return this.requestView(existing.id)
      }
      if (input.runner !== 'maestro') {
        this.assertAppiumEnabled()
      }
      if (this.state.requests.length >= 10000) {
        throw new CoordinatorError(429, 'queue_limit', 'Prototype request history limit reached')
      }
      const request: AllocationRequest = {
        id: randomUUID(), projectId, key, fingerprint, input, state: 'queued', createdAt: this.now()
      , queueDeadlineAt: this.now() + input.queueTimeoutSeconds * 1000
      }
      this.state.requests.push(request)
      await this.save()
      return this.requestView(request.id)
    })
  }

  cancel(id: string) {
    return this.exclusive(async() => {
      this.assertReady()
      const request = this.request(id)
      if (!requestTerminal.has(request.state)) {
        request.state = 'cancelled'
        await this.save()
        if (request.leaseId) {
          await this.beginCleanup(this.lease(request.leaseId), 'released')
        }
      }
      return this.requestView(id)
    })
  }

  async renew(id: string) {
    const lease = await this.exclusive(async() => {
      this.assertReady()
      const current = this.lease(id)
      this.assertActive(current)
      return current
    })
    await this.refreshOwnership(lease)
    return this.exclusive(async() => {
      // IO must not hold the state queue; cancellation/expiry may have won while it ran.
      this.assertActive(lease)
      lease.expiresAt = Math.min(lease.deadlineAt,
        this.now() + this.options.leaseTtlSeconds * 1000)
      await this.save()
      return this.leaseView(id)
    })
  }

  private async refreshOwnership(lease: Lease) {
    try {
      await this.backend.renew(lease.device.serial, lease.id, this.stfTimeoutMs)
    }
    catch {
      await this.exclusive(async() => {
        if (lease.state === 'active') {
          await this.beginCleanup(lease, 'expired', 'ownership_lost')
        }
      })
      throw new CoordinatorError(409, 'ownership_lost', 'STF lease renewal failed')
    }
    this.renewed.set(lease.id, this.now())
  }

  release(id: string) {
    return this.exclusive(async() => {
      this.assertReady()
      await this.beginCleanup(this.lease(id), 'released')
      return this.leaseView(id)
    })
  }

  async recover(id: string, reconciliation?: CaptureReconciliationInput) {
    if (reconciliation !== undefined) {
      return this.reconcileUnowned(id, reconciliation)
    }
    const lease = await this.exclusive(async() => {
      this.assertReady()
      const current = this.lease(id)
      if (this.reconciliations.has(id)) {
        throw new CoordinatorError(409, 'recovery_in_progress', 'Lease reconciliation is running')
      }
      if (current.state !== 'quarantined') {
        throw new CoordinatorError(409, 'not_quarantined', 'Lease is not quarantined')
      }
      current.state = 'cleaning'
      await this.save()
      return current
    })
    await this.cleanup(lease)
    return this.leaseView(id)
  }

  private reconcileUnowned(id: string, input: CaptureReconciliationInput) {
    if (!input || typeof input.serial !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,256}$/.test(input.serial) ||
        input.captureTransportRetired !== true || typeof input.reason !== 'string' ||
        !input.reason.trim() || input.reason.length > 1024 || input.actor !== 'operator' ||
        typeof input.projectId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.projectId)) {
      throw new CoordinatorError(400, 'invalid_reconciliation',
        'Expected the exact serial, operator identity and transport retirement acknowledgment')
    }
    const confirmed = {...input, reason: input.reason.trim()}
    const fingerprint = JSON.stringify([confirmed.serial, confirmed.reason
      , confirmed.actor, confirmed.projectId])
    const existing = this.reconciliations.get(id)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new CoordinatorError(409, 'recovery_in_progress', 'Lease reconciliation is running')
      }
      return existing.operation
    }
    const operation = this.reconcileCapture(id, confirmed)
    this.reconciliations.set(id, {fingerprint, operation})
    operation.finally(() => {
      if (this.reconciliations.get(id)?.operation === operation) {
        this.reconciliations.delete(id)
      }
    }).catch(() => {})
    return operation
  }

  private assertCaptureReconciliation(lease: Lease, serial: string) {
    this.assertReady()
    if (lease.state !== 'quarantined') {
      throw new CoordinatorError(409, 'not_quarantined', 'Lease is not quarantined')
    }
    if (lease.device.serial !== serial || lease.captureUncertain !== true ||
        lease.captureConfirmed === true || (lease.runner && lease.runner !== 'appium') ||
        lease.sessionId || lease.creatingSession || lease.commandInFlight ||
        this.allocations.has(lease.id) || this.commands.has(lease.id) ||
        this.cleanups.has(lease.id)) {
      throw new CoordinatorError(409, 'reconciliation_unavailable',
        'Only an idle uncertain Appium capture can be reconciled')
    }
    const settledAt = lease.createdAt + this.stfTimeoutMs +
      this.options.upstreamTimeoutSeconds * 1000
    if (this.now() < settledAt || this.now() < lease.expiresAt) {
      throw new CoordinatorError(409, 'capture_not_settled',
        'The original capture and its ownership timeout must finish first')
    }
  }

  private async captureReleased(lease: Lease) {
    const [devices, grid] = await Promise.all([this.backend.devices(), this.backend.grid()])
    const matches = Array.isArray(devices) ? devices.filter(device =>
      device?.serial === lease.device.serial) : []
    const device = matches.length === 1 ? matches[0]! : null
    if (!device || device.platform !== lease.device.platform ||
        device.provider !== lease.device.provider || device.present !== true ||
        device.ready !== true || device.owner || device.using || device.claimed ||
        device.usage || device.automationLeaseId) {
      throw new CoordinatorError(409, 'device_busy', 'STF does not confirm the device is free')
    }
    const record = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
    const nodes = grid?.nodes
    if (grid?.ready !== true || !Array.isArray(nodes) || !nodes.length) {
      throw new CoordinatorError(409, 'grid_unavailable', 'Grid cleanup is not confirmed')
    }
    const nodeIds = new Set<string>(); const sessions = new Set<string>()
    const pool = this.pools.find(item => item.provider === device.provider)
    let available = false
    for (const node of nodes) {
      if (!record(node) || typeof node.id !== 'string' || !node.id.trim() ||
          nodeIds.has(node.id) || typeof node.availability !== 'string' ||
          !Array.isArray(node.slots)) {
        throw new CoordinatorError(409, 'grid_unavailable', 'Grid cleanup is not confirmed')
      }
      nodeIds.add(node.id)
      for (const slot of node.slots) {
        if (!record(slot) || !record(slot.stereotype)) {
          throw new CoordinatorError(409, 'grid_unavailable', 'Grid cleanup is not confirmed')
        }
        const stereotype = slot.stereotype
        if (slot.session !== null) {
          const session = slot.session
          if (!record(session) || typeof session.sessionId !== 'string' ||
              !session.sessionId.trim() || sessions.has(session.sessionId) ||
              !record(session.capabilities) ||
              typeof session.capabilities['appium:udid'] !== 'string' ||
              !session.capabilities['appium:udid'].trim()) {
            throw new CoordinatorError(409, 'grid_unavailable', 'Grid cleanup is not confirmed')
          }
          sessions.add(session.sessionId)
          if (session.capabilities['appium:udid'] === device.serial ||
              session.capabilities['stf:leaseId'] === lease.id ||
              stereotype['appium:udid'] === device.serial) {
            throw new CoordinatorError(409, 'device_busy', 'Grid still reports a device session')
          }
        }
        const platform = stereotype.platformName
        const route = device.platform === 'Android' ? pool && matchesAdbRoute(stereotype, pool) :
          stereotype['appium:udid'] === device.serial &&
          stereotype['appium:platformVersion'] === device.version
        if (node.availability === 'UP' && slot.session === null &&
            typeof platform === 'string' &&
            platform.toLowerCase() === device.platform.toLowerCase() && route) {
          available = true
        }
      }
    }
    if (!available) {
      throw new CoordinatorError(409, 'grid_unavailable', 'No idle Grid route for the device')
    }
  }

  private async reconcileCapture(id: string, input: CaptureReconciliationInput) {
    const serial = input.serial
    const result = await this.exclusive(async() => {
      this.assertReady()
      const current = this.lease(id)
      const audit = current.captureReconciliation
      if (terminal.has(current.state) && audit) {
        if (current.device.serial !== serial || audit.mode !== 'unowned-capture' ||
            audit.captureTransportRetired !== true || audit.reason !== input.reason ||
            audit.actor !== input.actor || audit.projectId !== input.projectId) {
          throw new CoordinatorError(409, 'reconciliation_unavailable',
            'The completed reconciliation does not match this acknowledgment')
        }
        return {kind: 'completed', value: this.leaseView(id)} as const
      }
      this.assertCaptureReconciliation(current, serial)
      return {kind: 'pending', value: current} as const
    })
    if (result.kind === 'completed') {
      return result.value
    }
    const lease = result.value
    // The operator acknowledges retiring the old capture transport. Age and free
    // upstream observations alone cannot prove that delayed commands are gone.
    // Keep the quarantine during bounded reads without blocking other devices.
    await this.captureReleased(lease)
    await this.captureReleased(lease)
    return this.exclusive(async() => {
      if (this.lease(id) !== lease) {
        throw new CoordinatorError(409, 'reconciliation_unavailable', 'Lease identity changed')
      }
      this.assertCaptureReconciliation(lease, serial)
      const candidate: Lease = {...lease, state: lease.finishState || 'released'
        , captureReconciliation: {at: this.now(), mode: 'unowned-capture'
          , previousError: lease.error || 'cleanup_unconfirmed'
          , captureTransportRetired: true, reason: input.reason
          , actor: input.actor, projectId: input.projectId}}
      delete candidate.captureUncertain
      delete candidate.error
      // Do not expose a free slot until its reconciliation is durable. Retain
      // other Lease object identities used by operations already in flight.
      const state: CoordinatorState = {...this.state, leases: this.state.leases.map(item =>
        item === lease ? candidate : item)}
      try {
        await this.store.save(state)
      }
      catch {
        this.fault = true
        throw new CoordinatorError(503, 'state_unavailable', 'Persistent state is unavailable')
      }
      Object.assign(lease, candidate)
      delete lease.captureUncertain
      delete lease.error
      return this.leaseView(id)
    })
  }

  private assertActive(lease: Lease) {
    this.assertReady()
    if (lease.state !== 'active' || lease.expiresAt <= this.now() ||
        lease.deadlineAt <= this.now()) {
      throw new CoordinatorError(409, 'lease_inactive', 'Lease is no longer active')
    }
  }

  private held(lease: Lease) {
    return !terminal.has(lease.state)
  }

  maintenanceView(id: string) {
    this.assertReady()
    const maintenance = this.state.maintenance.find(item => item.id === id)
    if (!maintenance) {
      throw new CoordinatorError(404, 'maintenance_not_found', 'Maintenance operation not found')
    }
    return {...maintenance, createdAt: new Date(maintenance.createdAt).toISOString()
      , state: this.state.leases.some(lease => this.held(lease) &&
        lease.device.serial === maintenance.serial) ? 'draining' as const : 'ready' as const}
  }

  startMaintenance(serial: string, operationId: string) {
    return this.exclusive(async() => {
      this.assertReady()
      if (!validMaintenanceSerial(serial) || !validMaintenanceId(operationId)) {
        throw new CoordinatorError(400, 'invalid_maintenance',
          'Expected a serial and operation UUID')
      }
      const existing = this.state.maintenance.find(item => item.id === operationId ||
        item.serial === serial)
      if (existing) {
        if (existing.id !== operationId || existing.serial !== serial) {
          throw new CoordinatorError(409, 'maintenance_conflict',
            'Device or operation already drained')
        }
        return this.maintenanceView(existing.id)
      }
      this.assertAppiumEnabled()
      const devices = await this.backend.devices()
      const matching = devices.filter(device => device.serial === serial)
      if (matching.length !== 1) {
        throw new CoordinatorError(404, 'device_not_found', 'Device not found')
      }
      if (matching[0]!.platform !== 'iOS') {
        throw new CoordinatorError(400, 'unsupported_maintenance',
          'Maintenance requires an iOS device')
      }
      this.state.maintenance.push({id: operationId, serial, createdAt: this.now()})
      await this.save()
      return this.maintenanceView(operationId)
    })
  }

  finishMaintenance(id: string) {
    return this.exclusive(async() => {
      this.assertReady()
      const maintenance = this.maintenanceView(id)
      this.assertAppiumEnabled()
      if (maintenance.state !== 'ready') {
        throw new CoordinatorError(409, 'device_busy', 'Device still has coordinator leases')
      }
      // The drain stays in place throughout fresh external checks and durable removal.
      // No WDA restart or STF ownership mutation is performed by this API.
      const [devices, grid] = await Promise.all([this.backend.devices(), this.backend.grid()])
      const matches = devices.filter(device => device.serial === maintenance.serial)
      const device = matches.length === 1 ? matches[0]! : null
      const free = device && device.platform === 'iOS' && device.present && device.ready &&
        !device.owner && !device.using && !device.claimed && !device.usage &&
        !device.automationLeaseId
      if (!free || !wdaProfileCovers(device!.ios?.wda, this.now(),
        this.options.maxDurationSeconds)) {
        throw new CoordinatorError(409, 'device_not_ready',
          'Device must be free and have a fresh signing profile covering the duration limit')
      }
      const idle = grid?.ready === true && Array.isArray(grid.nodes) &&
        grid.nodes.some(node => node && node.availability === 'UP' &&
          Array.isArray(node.slots) && node.slots.some(slot =>
            slot.stereotype?.['appium:udid'] === maintenance.serial &&
            slot.stereotype?.['appium:platformVersion'] === device!.version)) &&
        grid.nodes.every(node => node && typeof node === 'object' &&
          Array.isArray(node.slots) && node.slots.every(slot => {
            if (!slot || !slot.stereotype || typeof slot.stereotype !== 'object') {
              return false
            }
            if (slot.session === null) {
              return true
            }
            const capabilities = slot.session?.capabilities
            return capabilities && typeof capabilities === 'object' &&
              !Array.isArray(capabilities) &&
              typeof capabilities['appium:udid'] === 'string' &&
              capabilities['appium:udid'] !== maintenance.serial &&
              slot.stereotype['appium:udid'] !== maintenance.serial
          }))
      if (!idle) {
        throw new CoordinatorError(409, 'device_busy', 'Grid session cleanup is not confirmed')
      }
      this.state.maintenance = this.state.maintenance.filter(item => item.id !== id)
      await this.save()
      return {id, serial: maintenance.serial, state: 'completed' as const}
    })
  }

  private matches(device: FarmDevice, request: AllocationRequest) {
    const input = request.input
    return !this.state.maintenance.some(item => item.serial === device.serial) &&
      (input.platform !== 'iOS' || wdaProfileCovers(device.ios?.wda, this.now(),
        input.maxDurationSeconds)) &&
      device.present && device.ready && !device.owner && !device.using && !device.claimed &&
      device.platform === input.platform &&
      (!input.serial || input.serial === device.serial) &&
      (!input.model || input.model === device.model) &&
      (!input.provider || input.provider === device.provider) &&
      !this.state.leases.some(lease => this.held(lease) && lease.device.serial === device.serial)
  }

  private connection(device: FarmDevice, grid: GridStatus | null,
    runner = 'appium'): Record<string, unknown> | null {
    const pool = device.platform === 'Android' ?
      this.pools.find(item => item.provider === device.provider) : null
    if (runner === 'maestro') {
      return pool ? {} : null
    }
    if (!grid || (device.platform === 'Android' && !pool?.systemPorts.length)) {
      return null
    }
    if (pool && this.pools.some(other => other.host === pool.host &&
      other.port !== pool.port && other.systemPorts.length) && grid.nodes.some(node =>
      node.availability === 'UP' && node.slots.some(({stereotype}) =>
        String(stereotype.platformName).toLowerCase() === 'android' &&
        stereotype['appium:remoteAdbHost'] === pool.host &&
        typeof stereotype['appium:adbPort'] === 'undefined'))) {
      // Grid can route either ADB port to a legacy slot that advertises only the hostname.
      return null
    }
    const nodes = grid.nodes.filter(node => node.availability === 'UP' &&
      node.slots.some(slot => {
        const cap = slot.stereotype
        return String(cap.platformName).toLowerCase() === device.platform.toLowerCase() &&
          (pool ? matchesAdbRoute(cap, pool) :
            cap['appium:udid'] === device.serial &&
            cap['appium:platformVersion'] === device.version)
      }))
    const free = nodes.filter(node => node.slots.every(slot => !slot.session)).length
    const sessions = new Set(nodes.flatMap(node => node.slots)
      .flatMap(slot => slot.session ? [slot.session.sessionId] : []))
    const pending = this.state.leases.filter(lease => this.held(lease) &&
      (lease.runner || 'appium') === 'appium' && lease.device.platform === device.platform &&
      (pool ? matchesAdbRoute(lease.capabilities, pool) :
        lease.device.serial === device.serial) &&
      (!lease.sessionId || !sessions.has(lease.sessionId))).length
    if (free <= pending) {
      return null
    }
    const result: Record<string, unknown> = {
      platformName: device.platform, 'appium:udid': device.serial
    , 'appium:automationName': device.platform === 'Android' ? 'UiAutomator2' : 'XCUITest'
    , 'appium:noReset': true, 'appium:newCommandTimeout': 120
    }
    if (!pool) {
      return {...result, 'appium:platformVersion': device.version, 'appium:autoLaunch': false
      , 'appium:skipLogCapture': true, 'appium:shouldTerminateApp': false}
    }
    const unavailable = new Set(this.state.leases.filter(lease => this.held(lease) &&
      (lease.runner || 'appium') === 'appium' &&
      lease.capabilities['appium:remoteAdbHost'] === pool.host)
      .map(lease => lease.capabilities['appium:systemPort']))
    for (const slot of grid.nodes.flatMap(node => node.slots)) {
      if (slot.session?.capabilities['appium:remoteAdbHost'] === pool.host) {
        unavailable.add(slot.session.capabilities['appium:systemPort'])
      }
    }
    const port = pool.systemPorts.find(value => !unavailable.has(value))
    return port === undefined ? null : {...result, 'appium:remoteAdbHost': pool.host
    , 'appium:adbPort': pool.port, 'appium:systemPort': port, 'appium:suppressKillServer': true}
  }

  tick(): Promise<void> {
    if (this.ticking) {
      return this.ticking
    }
    const operation = this.schedule()
    this.ticking = operation
    operation.finally(() => {
      if (this.ticking === operation) {
        this.ticking = null
      }
    }).catch(() => {})
    return operation
  }

  private async schedule() {
    const maintenance = await this.exclusive(async() => {
      if (!this.ready) {
        return null
      }
      const cleaning: Lease[] = []
      const refreshing: Lease[] = []
      for (const lease of this.state.leases.filter(item => this.held(item))) {
        if (lease.state === 'active' &&
            (lease.expiresAt <= this.now() || lease.deadlineAt <= this.now())) {
          await this.beginCleanup(lease, 'expired', 'heartbeat_expired')
        }
        if (lease.state === 'cleaning') {
          cleaning.push(lease)
        }
        if (this.held(lease) && lease.state !== 'allocating' &&
            this.now() - (this.renewed.get(lease.id) || 0) >=
            this.options.heartbeatIntervalSeconds * 1000) {
          refreshing.push(lease)
        }
      }
      for (const request of this.state.requests.filter(item => item.state === 'queued')) {
        if (request.queueDeadlineAt <= this.now()) {
          request.state = 'expired'
          request.error = 'queue_timeout'
          if (request.leaseId) {
            await this.beginCleanup(this.lease(request.leaseId), 'expired', 'queue_timeout')
          }
          await this.save()
        }
      }
      return {cleaning, refreshing}
    })
    if (!maintenance) {
      return
    }
    // Slow recovery or one unavailable phone must not block another worker's heartbeat.
    await Promise.all([
      ...maintenance.cleaning.map(lease => this.cleanup(lease))
    , ...maintenance.refreshing.map(lease => this.refreshOwnership(lease).catch(() => {}))
    ])
    const needed = await this.exclusive(async() => this.ready &&
      this.state.requests.some(request => request.state === 'queued') &&
      this.state.leases.filter(lease => this.held(lease)).length < this.options.maxParallel)
    if (!needed) {
      return
    }
    let devices: FarmDevice[]
      let grid: GridStatus | null = null
    try {
      devices = await this.backend.devices()
      if (this.state.requests.some(request => request.state === 'queued' &&
          request.input.runner !== 'maestro')) {
        // Grid failure may delay Appium, but must not prevent independent Maestro allocations.
        try {
 grid = await this.backend.grid()
}
        catch {
 this.lastError = 'Appium Grid is temporarily unavailable'
}
      }
    }
    catch {
      this.lastError = 'Farm inventory is temporarily unavailable'
      return
    }
    const allocations = await this.exclusive(async() => {
      if (!this.ready) {
        return []
      }
      this.lastError = null
      const reserved: {lease: Lease, request: AllocationRequest}[] = []
      for (const request of this.state.requests.filter(item => item.state === 'queued')) {
        if (request.queueDeadlineAt <= this.now()) {
          request.state = 'expired'
          request.error = 'queue_timeout'
          await this.save()
          continue
        }
        if (this.state.leases.filter(lease => this.held(lease)).length >=
            this.options.maxParallel) {
          break
        }
        const projectId = request.projectId || 'legacy'
        if (projectId !== 'legacy' && !this.projectLimits.has(projectId)) {
          request.state = 'failed'
          request.error = 'project_disabled'
          await this.save()
          continue
        }
        const projectLimit = this.projectLimits.get(projectId) || this.options.maxParallel
        if (this.state.leases.filter(lease => this.held(lease) &&
            (lease.projectId || 'legacy') === projectId).length >= projectLimit) {
          continue
        }
        for (const device of [...devices].sort((a, b) => a.serial.localeCompare(b.serial))) {
          if (!this.matches(device, request)) {
            continue
          }
          const capabilities = this.connection(device, grid, request.input.runner || 'appium')
          if (!capabilities) {
            continue
          }
          const time = this.now()
          const lease: Lease = {
            id: randomUUID(), projectId, requestId: request.id, runId: request.input.runId
          , runner: request.input.runner || 'appium', state: 'allocating'
          , device: structuredClone(device), capabilities
          , createdAt: time, expiresAt: time + this.options.leaseTtlSeconds * 1000
          , deadlineAt: time + request.input.maxDurationSeconds * 1000
          , captureUncertain: true
          }
          lease.expiresAt = Math.min(lease.expiresAt, lease.deadlineAt)
          request.leaseId = lease.id
          this.state.leases.push(lease)
          await this.save()
          reserved.push({lease, request})
          break
        }
      }
      return reserved
    })
    await Promise.all(allocations.map(({lease, request}) => {
      const operation = this.allocate(lease, request)
      this.allocations.set(lease.id, operation)
      return operation.finally(async() => {
        this.allocations.delete(lease.id)
        if (lease.state === 'cleaning') {
          await this.cleanup(lease)
        }
      })
    }))
  }

  private async allocate(lease: Lease, request: AllocationRequest) {
    try {
      await this.backend.capture(lease.device.serial, lease.id, this.stfTimeoutMs, lease.runner)
      const continuing = await this.exclusive(async() => {
        lease.captureConfirmed = true
        delete lease.captureUncertain
        if (!this.ready || lease.state !== 'allocating' || request.state !== 'queued' ||
            request.queueDeadlineAt <= this.now() || lease.deadlineAt <= this.now()) {
          if (request.state === 'queued') {
            request.state = 'expired'
          }
          await this.beginCleanup(lease, 'released', 'allocation_cancelled')
          return false
        }
        await this.save()
        return true
      })
      if (!continuing) {
        return
      }
      await this.backend.renew(lease.device.serial, lease.id, this.stfTimeoutMs)
      if (lease.runner === 'maestro') {
        if (!this.backend.maestroBaseline || !this.backend.maestroPrepare) {
          throw new Error('Maestro device adapter is unavailable')
        }
        const baseline = await this.backend.maestroBaseline(lease.device)
        const prepare = await this.exclusive(async() => {
          // Persist recovery data before any preparation or worker can mutate the phone.
          lease.maestroBaseline = baseline
          await this.save()
          return this.ready && lease.state === 'allocating' && request.state === 'queued'
        })
        if (!prepare) {
 return
}
        await this.backend.renew(lease.device.serial, lease.id, this.stfTimeoutMs)
        await this.backend.maestroPrepare(lease.device)
      }
      await this.exclusive(async() => {
        // A cancellation/stop during capture must never be overwritten by the late result.
        if (!this.ready || lease.state !== 'allocating' || request.state !== 'queued' ||
            request.queueDeadlineAt <= this.now() || lease.deadlineAt <= this.now()) {
          if (request.state === 'queued') {
            request.state = 'expired'
          }
          await this.beginCleanup(lease, 'released', 'allocation_cancelled')
          return
        }
        lease.state = 'active'
        lease.expiresAt = Math.min(lease.deadlineAt,
          this.now() + this.options.leaseTtlSeconds * 1000)
        request.state = 'allocated'
        delete request.error
        this.renewed.set(lease.id, this.now())
        await this.save()
      })
    }
    catch (error) {
      await this.exclusive(async() => {
        if (!lease.captureConfirmed && error instanceof BackendError &&
            [403, 409].includes(error.status)) {
          lease.state = 'released'
          delete lease.captureUncertain
          if (request.state === 'queued') {
            delete request.leaseId
          }
        }
        else {
          if (request.state === 'queued') {
            request.state = 'failed'
            request.error = 'allocation_failed'
          }
          await this.beginCleanup(lease, 'released', 'allocation_failed')
        }
        await this.save()
      })
    }
  }

  /** Call while holding the state queue, then perform upstream cleanup outside it. */
  private async beginCleanup(lease: Lease, finish: 'released' | 'expired', error?: string) {
    if (terminal.has(lease.state)) {
      return
    }
    lease.state = 'cleaning'
    this.closeAdb(lease.id)
    lease.finishState ||= finish
    if (error) {
      lease.error = error
    }
    await this.save()
  }

  private cleanup(lease: Lease): Promise<void> {
    const existing = this.cleanups.get(lease.id)
    if (existing) {
      return existing
    }
    const operation = this.cleanLease(lease)
    this.cleanups.set(lease.id, operation)
    operation.finally(() => {
      if (this.cleanups.get(lease.id) === operation) {
        this.cleanups.delete(lease.id)
      }
    }).catch(() => {})
    return operation
  }

  private async cleanLease(lease: Lease) {
    this.closeAdb(lease.id)
    try {
      const pending = await this.exclusive(async() => terminal.has(lease.state) ||
        this.allocations.has(lease.id) || this.closingSessions.has(lease.id) ||
        (lease.creatingSession && this.commands.has(lease.id)))
      if (pending) {
        return
      }
      if (lease.creatingSession) {
        const grid = await this.backend.grid({allowBusy: true})
        const sessions = grid.nodes.flatMap(node => node.slots).flatMap(slot =>
          slot.session && slot.session.capabilities['stf:leaseId'] === lease.id ?
            [slot.session.sessionId] : [])
        if (sessions.length !== 1) {
          throw new Error('Uncertain Appium session creation')
        }
        await this.exclusive(async() => {
          lease.sessionId = sessions[0]!
          delete lease.creatingSession
          if (!this.commands.has(lease.id)) {
            delete lease.commandInFlight
          }
          await this.save()
        })
      }
      if (lease.sessionId) {
        const session = lease.sessionId
        const response = await this.backend.webdriver('DELETE',
          '/session/' + encodeURIComponent(session))
        if (response.status >= 300 && response.status !== 404) {
          throw new Error('Appium session cleanup failed')
        }
        await this.confirmAppiumSessionEnded(session)
        const settled = await this.exclusive(async() => {
          // Preserve the SID until an accepted command settles; a late failure must
          // retain the identity needed to reconfirm termination on the next cleanup.
          if (lease.commandInFlight && this.commands.has(lease.id)) {
            return false
          }
          delete lease.sessionId
          delete lease.commandInFlight
          await this.save()
          return true
        })
        if (!settled) {
          return
        }
      }
      if (lease.commandInFlight) {
        if (this.commands.has(lease.id)) {
          return
        }
        throw new Error('Uncertain in-flight command')
      }
      const device = (await this.backend.devices())
        .find(item => item.serial === lease.device.serial)
      if (!device) {
        throw new Error('Device is unavailable during cleanup')
      }
      if (device.owner) {
        if (device.owner.email !== this.owner || device.automationLeaseId !== lease.id) {
          throw new Error('Device ownership changed; refusing to release another lease')
        }
        // The provider owns Maestro cleanup, including after its heartbeat fence expires.
        // Its release acknowledgment is emitted only after driver and baseline verification.
        await this.backend.release(device.serial, lease.id)
        if (lease.runner === 'maestro') {
          await this.exclusive(async() => {
            lease.maestroCleanupConfirmed = true
            await this.save()
          })
        }
        const after = (await this.backend.devices()).find(item => item.serial === device.serial)
        if (!after || after.owner || after.automationLeaseId) {
          throw new Error('STF ownership release is not confirmed')
        }
      }
      else if (lease.captureUncertain) {
        throw new Error('Uncertain STF capture; requires operator recovery')
      }
      else if (lease.runner === 'maestro' && !lease.maestroCleanupConfirmed) {
        throw new Error('Missing provider Maestro cleanup acknowledgment')
      }
      await this.exclusive(async() => {
        lease.state = lease.finishState || 'released'
        delete lease.error
        await this.save()
      })
    }
    catch {
      await this.exclusive(async() => {
        lease.state = 'quarantined'
        lease.error = 'cleanup_unconfirmed'
        await this.save()
      })
    }
  }

  private async confirmAppiumSessionEnded(sessionId: string) {
    // Grid updates the Distributor's slot after the relay acknowledges the DELETE.
    for (const delay of [0, 50, 100, 200, 400, 800]) {
      await wait(delay)
      const grid = await this.backend.grid({allowBusy: true})
      const stillActive = grid.nodes.some(node => node.slots.some(slot =>
        slot.session?.sessionId === sessionId))
      if (!stillActive) {
        return
      }
    }
    throw new Error('Grid still reports the Appium session')
  }

  private createCapabilities(lease: Lease, body: unknown): unknown {
    const input = body as {capabilities?: {
      alwaysMatch?: Record<string, unknown>, firstMatch?: Record<string, unknown>[]
    }}
    const record = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
    const capabilities = input?.capabilities
    if (!record(input) || !record(capabilities) ||
        (capabilities.alwaysMatch !== undefined && !record(capabilities.alwaysMatch)) ||
        (capabilities.firstMatch !== undefined && (!Array.isArray(capabilities.firstMatch) ||
          capabilities.firstMatch.length !== 1 || !record(capabilities.firstMatch[0]))) ||
        (body as Record<string, unknown>).desiredCapabilities) {
      throw new CoordinatorError(400, 'invalid_capabilities', 'Expected one W3C capability set')
    }
    const supplied = {...capabilities.alwaysMatch
      , ...(capabilities.firstMatch || [{}])[0]}
    const protectedKeys = new Set(['platformName', 'appium:udid', 'appium:systemPort'
      , 'appium:remoteAdbHost', 'appium:adbPort', 'appium:automationName', 'appium:platformVersion'
      , 'appium:suppressKillServer', 'suppressKillServer'
      , 'appium:webDriverAgentUrl', 'appium:derivedDataPath', 'appium:wdaLocalPort'
      , 'appium:newCommandTimeout', 'appium:autoLaunch', 'appium:shouldTerminateApp'
    , 'stf:leaseId'])
    for (const [key, value] of Object.entries(supplied)) {
      const matching = key === 'platformName' ?
        String(lease.capabilities[key]).toLowerCase() === String(value).toLowerCase() :
        lease.capabilities[key] === value
      if (protectedKeys.has(key) && !matching) {
        throw new CoordinatorError(409, 'capability_conflict',
          'A requested capability conflicts with the allocated connection')
      }
      if (key === 'appium:options' || key === 'desiredCapabilities') {
        throw new CoordinatorError(400, 'invalid_capabilities',
          'Nested capability overrides are not supported')
      }
    }
    return {capabilities: {alwaysMatch: {...supplied, ...lease.capabilities
      , 'stf:leaseId': lease.id}, firstMatch: [{}]}}
  }

  async webdriver(id: string, method: string, route: string, body?: unknown) {
    const lease = this.lease(id)
    this.assertActive(lease)
    if (lease.runner === 'maestro') {
      throw new CoordinatorError(409, 'runner_conflict', 'This lease does not use WebDriver')
    }
    const parts = route.split('/').slice(1).map(part => decodeURIComponent(part))
    if (parts.some(part => part === '.' || part === '..' ||
        part.includes('%') || part.includes('/') || part.includes('\\') ||
        [...part].some(character => character.charCodeAt(0) <= 32))) {
      throw new CoordinatorError(400, 'invalid_webdriver_path', 'Invalid WebDriver path')
    }
    const create = route === '/session' && method === 'POST'
    if (!create && !route.startsWith('/session/')) {
      throw new CoordinatorError(404, 'webdriver_route', 'Unsupported WebDriver route')
    }
    const closingSession = method === 'DELETE' && parts.length === 2 ? parts[1] : undefined
    const operation = async(): Promise<UpstreamResponse> => {
      let payload = body
      await this.exclusive(async() => {
        this.assertActive(lease)
        if (create) {
          if (lease.sessionId || lease.creatingSession) {
            throw new CoordinatorError(409, 'session_exists', 'Lease already has an Appium session')
          }
          payload = this.createCapabilities(lease, body)
        }
        else {
          const session = decodeURIComponent(route.split('/')[2] || '')
          if (session !== lease.sessionId) {
            throw new CoordinatorError(404, 'session_not_found', 'Session does not belong to lease')
          }
        }
      })
      await this.refreshOwnership(lease)
      await this.exclusive(async() => {
        this.assertActive(lease)
        if (create) {
          lease.creatingSession = true
        }
        lease.commandInFlight = true
        await this.save()
        if (closingSession) {
          this.closingSessions.add(lease.id)
        }
      })
      let response: UpstreamResponse
      let sessionClosed = false
      try {
        response = await this.backend.webdriver(method, route, payload)
        if (closingSession && response.status >= 200 && response.status < 300) {
          await this.confirmAppiumSessionEnded(closingSession)
          sessionClosed = true
        }
      }
      catch {
        await this.exclusive(async() => {
          await this.beginCleanup(lease, 'expired', 'upstream_outcome_unknown')
          lease.state = 'quarantined'
          await this.save()
        })
        throw new CoordinatorError(502, 'upstream_unknown', 'Appium outcome is uncertain')
      }
      await this.exclusive(async() => {
        delete lease.commandInFlight
        if (create) {
          let sessionId: string | undefined
          try {
            const result = JSON.parse(response.body.toString()) as {
              value?: {sessionId?: string}, sessionId?: string
            }
            sessionId = result.value?.sessionId || result.sessionId
          }
          catch {
            // Preserve the creation marker so recovery cannot blindly reissue the phone.
          }
          if (response.status >= 300 || !sessionId || typeof sessionId !== 'string') {
            lease.state = 'quarantined'
            lease.error = 'uncertain_session_creation'
            await this.save()
            throw new CoordinatorError(502, 'upstream_unknown', 'Appium session is uncertain')
          }
          lease.sessionId = sessionId
          delete lease.creatingSession
        }
        else if (sessionClosed) {
          delete lease.sessionId
        }
        await this.save()
        this.assertActive(lease)
      })
      return response
    }
    const previous = this.commands.get(id) || Promise.resolve()
    const result = previous.catch(() => {}).then(operation).finally(() => {
      if (closingSession) {
        this.closingSessions.delete(lease.id)
      }
    })
    this.commands.set(id, result)
    try {
      return await result
    }
    finally {
      if (this.commands.get(id) === result) {
        this.commands.delete(id)
      }
    }
  }

  async stop() {
    this.stopping = true
    await this.exclusive(async() => {
      for (const lease of this.state.leases.filter(item => this.held(item))) {
        await this.beginCleanup(lease, 'expired', 'coordinator_stopped')
      }
    })
    // Pending capture/commands cannot resurrect a lease after the stop marker.
    await Promise.allSettled([
      ...(this.ticking ? [this.ticking] : [])
    , ...this.allocations.values(), ...this.commands.values(), ...this.cleanups.values()
    ])
    await Promise.all(this.state.leases.filter(item => this.held(item))
      .map(lease => this.cleanup(lease)))
  }
}
