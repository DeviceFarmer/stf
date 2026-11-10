import type {MaestroBaseline} from '../../util/maestro-device.js'
export type {MaestroBaseline} from '../../util/maestro-device.js'

export interface AdbPool {
  provider: string
  host: string
  port: number
  systemPorts: number[]
}

export interface CoordinatorOptions {
  host: string
  port: number
  publicUrl: string
  stfApiUrl: string
  stfTokenFile: string
  apiTokenFile: string
  appiumGridUrl?: string
  stateFile: string
  adbPoolsFile: string
  projectTokensFile?: string
  leaseTtlSeconds: number
  heartbeatIntervalSeconds: number
  pollIntervalSeconds: number
  maxDurationSeconds: number
  maxParallel: number
  upstreamTimeoutSeconds: number
}

export type Platform = 'Android' | 'iOS'
export type Runner = 'appium' | 'maestro'

export type RequestState = 'queued' | 'allocated' | 'cancelled' | 'expired' | 'failed'
export type LeaseState = 'allocating' | 'active' | 'cleaning' |
  'released' | 'expired' | 'quarantined'

export interface AllocationInput {
  runId: string
  runner?: Runner
  platform: Platform
  serial?: string
  model?: string
  provider?: string
  queueTimeoutSeconds: number
  maxDurationSeconds: number
}

export interface AllocationRequest {
  id: string
  projectId?: string
  key: string
  fingerprint: string
  input: AllocationInput
  state: RequestState
  createdAt: number
  queueDeadlineAt: number
  leaseId?: string
  error?: string
}

export interface WdaProfile {
  profile: 'valid' | 'expiring' | 'expired' | 'missing' | 'unknown' | 'ambiguous'
  expiresAt: string | null
  checkedAt: string | null
}

export interface DeviceMaintenance {
  id: string
  serial: string
  createdAt: number
}

export interface FarmDevice {
  serial: string
  model: string
  platform: Platform
  version: string
  provider: string
  present: boolean
  ready: boolean
  using?: boolean
  claimed?: boolean
  owner?: {email: string} | null
  usage?: string | null
  automationLeaseId?: string | null
  ios?: {wda: WdaProfile}
}

export interface CaptureReconciliationInput {
  serial: string
  captureTransportRetired: true
  reason: string
  actor: 'operator'
  projectId: string
}

export interface CaptureReconciliationAudit {
  at: number
  previousError: string
  mode: 'unowned-capture'
  captureTransportRetired: true
  reason: string
  actor: 'operator'
  projectId: string
}

export interface Lease {
  id: string
  projectId?: string
  requestId: string
  runId: string
  runner?: Runner
  maestroBaseline?: MaestroBaseline
  maestroCleanupConfirmed?: boolean
  state: LeaseState
  device: FarmDevice
  capabilities: Record<string, unknown>
  expiresAt: number
  deadlineAt: number
  createdAt: number
  sessionId?: string
  appiumNodeId?: string
  creatingSession?: boolean
  commandInFlight?: boolean
  captureUncertain?: boolean
  captureConfirmed?: boolean
  captureReconciliation?: CaptureReconciliationAudit
  finishState?: 'released' | 'expired'
  error?: string
}

export interface CoordinatorState {
  version: 2
  requests: AllocationRequest[]
  leases: Lease[]
  maintenance: DeviceMaintenance[]
}

export interface GridSlot {
  stereotype: Record<string, unknown>
  session: null | {sessionId: string, capabilities: Record<string, unknown>}
}

export interface GridStatus {
  ready: boolean
  nodes: {id: string, availability: string, slots: GridSlot[]}[]
}

export interface UpstreamResponse {
  status: number
  contentType: string
  body: Buffer
}

export interface FarmBackend {
  identity(): Promise<{email: string}>
  devices(): Promise<FarmDevice[]>
  grid(options?: {allowBusy?: boolean}): Promise<GridStatus>
  capture(serial: string, leaseId: string, timeout: number, runner?: Runner): Promise<void>
  renew(serial: string, leaseId: string, timeout: number): Promise<void>
  release(serial: string, leaseId: string): Promise<void>
  maestroBaseline?(device: FarmDevice): Promise<MaestroBaseline>
  maestroPrepare?(device: FarmDevice): Promise<void>
  maestroCleanup?(device: FarmDevice, baseline: MaestroBaseline): Promise<void>
  webdriver(method: string, path: string, body?: unknown): Promise<UpstreamResponse>
}
