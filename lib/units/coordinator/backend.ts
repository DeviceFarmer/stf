import {CoordinatorError, endpoint} from './config.js'
import {MaestroDeviceAdapter} from './maestro.js'
import {readWdaProfile} from './wda-profile.js'
import type {AdbPool, FarmBackend, FarmDevice, GridStatus, MaestroBaseline, Runner
  , UpstreamResponse} from './types.js'

type StfDevice = Omit<FarmDevice, 'provider'> & {provider: string | {name: string}}

export class BackendError extends Error {
  constructor(readonly status: number, readonly operation: string) {
    super(`${operation} returned HTTP ${status}`)
  }
}

export class HttpFarmBackend implements FarmBackend {
  private readonly stfUrl: string
  private readonly gridUrl?: string
  private readonly maestro: MaestroDeviceAdapter

  constructor(stfUrl: string, gridUrl: string | undefined, private readonly token: string,
    private readonly timeoutMs: number, pools: AdbPool[] = []) {
    this.stfUrl = endpoint(stfUrl).replace(/(?:\/api\/v1)?$/, '/api/v1')
    if (typeof gridUrl !== 'undefined') {
      this.gridUrl = endpoint(gridUrl)
    }
    this.maestro = new MaestroDeviceAdapter(pools)
  }

  private async stf(method: string, route: string, body?: unknown): Promise<any> {
    const response = await fetch(this.stfUrl + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)
    , headers: {Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json'}
    , ...(body === undefined ? {} : {body: JSON.stringify(body)})
    })
    if (!response.ok) {
      throw new BackendError(response.status, 'STF ' + method + ' ' + route.split('/')[1])
    }
    const value = await response.json() as any
    if (value.success === false) {
      throw new BackendError(502, 'STF operation')
    }
    return value
  }

  async identity(): Promise<{email: string}> {
    const result = await this.stf('GET', '/user')
    if (typeof result.user?.email !== 'string') {
      throw new CoordinatorError(503, 'stf_identity', 'STF service account is unavailable')
    }
    return {email: result.user.email}
  }

  async devices(): Promise<FarmDevice[]> {
    const result = await this.stf('GET', '/devices')
    return result.devices.map((device: StfDevice) => {
      const wda = device.platform === 'iOS' ? readWdaProfile(device.ios?.wda) : null
      return {
        serial: device.serial, model: device.model || '', version: device.version || ''
      , platform: device.platform, provider: typeof device.provider === 'string' ?
          device.provider : device.provider?.name || ''
      , present: device.present, ready: device.ready, using: device.using, claimed: device.claimed
      , owner: device.owner || null, usage: device.usage || null
      , automationLeaseId: device.automationLeaseId || null
      , ...(wda ? {ios: {wda}} : {})
      }
    })
  }

  async grid({allowBusy = false}: {allowBusy?: boolean} = {}): Promise<GridStatus> {
    const response = await fetch(this.gridEndpoint() + '/status', {
      redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) {
      throw new BackendError(response.status, 'Grid status')
    }
    const {value: grid} = await response.json() as {value: GridStatus}
    if (!Array.isArray(grid?.nodes) ||
        !grid.ready && !(allowBusy && grid.nodes.some(node => node.availability === 'UP'))) {
      throw new BackendError(503, 'Grid readiness')
    }
    return grid
  }

  private gridEndpoint(): string {
    if (!this.gridUrl) {
      throw new Error('Appium Grid URL is not configured')
    }
    return this.gridUrl
  }

  async capture(serial: string, leaseId: string, timeout: number, runner?: Runner) {
    const result = await this.stf('POST', '/user/devices', {serial, leaseId, timeout
      , ...(runner === 'maestro' ? {automationRunner: 'maestro'} : {})})
    if (runner === 'maestro' && result.automationRunner !== 'maestro') {
      throw new Error('The STF provider did not confirm Maestro cleanup protection')
    }
  }

  async renew(serial: string, leaseId: string, timeout: number) {
    await this.stf('POST', `/user/devices/${encodeURIComponent(serial)}/automation/renew`, {
      leaseId, timeout
    })
  }

  async release(serial: string, leaseId: string) {
    await this.stf('POST', `/user/devices/${encodeURIComponent(serial)}/automation/release`,
      {leaseId})
  }

  maestroBaseline(device: FarmDevice): Promise<MaestroBaseline> {
    return this.maestro.baseline(device)
  }

  maestroPrepare(device: FarmDevice): Promise<void> {
    return this.maestro.prepare(device)
  }

  maestroCleanup(device: FarmDevice, baseline: MaestroBaseline): Promise<void> {
    return this.maestro.cleanup(device, baseline)
  }

  async webdriver(method: string, route: string, body?: unknown): Promise<UpstreamResponse> {
    // A body parser may supply {} for a bodyless command; fetch rejects GET/HEAD payloads.
    const hasBody = body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())
    const response = await fetch(this.gridEndpoint() + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)
    , headers: {'Content-Type': 'application/json'}
    , ...(hasBody ? {body: JSON.stringify(body)} : {})
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 32 * 1024 * 1024) {
      throw new BackendError(502, 'Oversized WebDriver response')
    }
    return {status: response.status, contentType: response.headers.get('content-type') ||
      'application/json', body: bytes}
  }
}
