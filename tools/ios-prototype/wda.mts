export class WdaError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

interface WdaResponse {
  value: any
  sessionId?: string
}

export class WdaClient {
  sessionId: string | null = null
  readonly origin: string
  private timeout: number
  private healthTimeout: number

  constructor(origin: string, timeout = 10000, healthTimeout = 60000) {
    this.origin = origin
    this.timeout = timeout
    this.healthTimeout = healthTimeout
  }

  async request(
    method: string, path: string, body?: unknown, signal?: AbortSignal
  ): Promise<WdaResponse> {
    return this.requestWithSignal(method, path, body,
      AbortSignal.any([AbortSignal.timeout(this.timeout), ...(signal ? [signal] : [])]))
  }

  private async requestWithSignal(
    method: string, path: string, body: unknown, signal: AbortSignal
  ): Promise<WdaResponse> {
    const response = await fetch(this.origin + path, {
      method
    , signal
    , ...(typeof body === 'undefined' ? {} : {
        headers: {'Content-Type': 'application/json'}
      , body: JSON.stringify(body)
      })
    })
    const result = await response.json() as WdaResponse
    if (!response.ok || result.value?.error) {
      throw new WdaError(result.value?.message || 'WDA HTTP ' + response.status,
        result.value?.error || 'wda_error')
    }
    return result
  }

  async probeSession(signal?: AbortSignal): Promise<WdaResponse> {
    if (!this.sessionId) {
      throw new Error('WDA session is not ready')
    }
    const path = '/session/' + encodeURIComponent(this.sessionId)
    // An external WDA command can keep XCTest busy longer than an input request.
    const active = AbortSignal.any([
      AbortSignal.timeout(this.healthTimeout), ...(signal ? [signal] : [])
    ])
    await this.requestWithSignal('GET', path, undefined, active)
    return this.requestWithSignal('GET', path + '/wda/locked', undefined, active)
  }

  async open(): Promise<void> {
    const response = await this.request('POST', '/session', {capabilities: {alwaysMatch: {}}})
    this.sessionId = response.sessionId || response.value?.sessionId
    if (typeof this.sessionId !== 'string' || !this.sessionId) {
      this.sessionId = null
      throw new Error('WDA did not return a session ID')
    }
  }

  async close(): Promise<void> {
    const session = this.sessionId
    this.sessionId = null
    if (session) {
      await this.request('DELETE', '/session/' + encodeURIComponent(session))
    }
  }

  call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<WdaResponse> {
    if (!this.sessionId) {
      throw new Error('WDA session is not ready')
    }
    return this.request(method, '/session/' + encodeURIComponent(this.sessionId) + path,
      body, signal)
  }

  async gesture(
    from: {x: number, y: number}, to: {x: number, y: number} | null = null
    , duration = 50, signal?: AbortSignal
  ): Promise<void> {
    const target = to || from
    const {value: size} = await this.call('GET', '/window/size', undefined, signal)
    if (!(size?.width > 0 && size?.height > 0)) {
      throw new Error('WDA did not return a valid window size')
    }
    const position = (point: {x: number, y: number}) => ({
      x: Math.round(point.x * (size.width - 1))
    , y: Math.round(point.y * (size.height - 1))
    })
    await this.call('POST', '/actions', {actions: [{
      type: 'pointer'
    , id: 'finger'
    , parameters: {pointerType: 'touch'}
    , actions: [
        {type: 'pointerMove', duration: 0, origin: 'viewport', ...position(from)}
      , {type: 'pointerDown', button: 0}
      , ...(from === target ? [{type: 'pause', duration}] : [
          {type: 'pointerMove', duration, origin: 'viewport', ...position(target)}
        ])
      , {type: 'pointerUp', button: 0}
      ]
    }]}, signal)
  }
}
