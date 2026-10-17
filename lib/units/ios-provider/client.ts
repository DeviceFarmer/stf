import {readFile} from 'node:fs/promises'
import type {IosDeviceStatus} from '../../util/ios-device-status.js'

export interface IosDeviceState {
  udid: string
  state: string
  generation: number
  instance?: string
  ios?: IosDeviceStatus
  info?: {ProductType?: string, ProductVersion?: string, DeviceName?: string}
}

export class PrototypeClient {
  constructor(readonly baseUrl: string, private readonly token: string) {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
      throw new Error('The prototype API must use a loopback HTTP address')
    }
  }

  static async fromFile(baseUrl: string, path: string) {
    const token = (await readFile(path, 'utf8')).trim()
    if (token.length < 32) {
      throw new Error('The prototype token must contain at least 32 characters')
    }
    return new PrototypeClient(baseUrl, token)
  }

  async request(path: string, body?: unknown, signal = AbortSignal.timeout(15000)) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: body === undefined ? 'GET' : 'POST'
    , headers: {Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json'}
    , ...(body === undefined ? {} : {body: JSON.stringify(body)})
    , signal
    , redirect: 'error'
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {error?: unknown} | null
      throw new Error(typeof body?.error === 'string' && /^IOS_[A-Z_]+$/.test(body.error) ?
        body.error : 'iOS backend returned HTTP ' + response.status)
    }
    return response
  }

  async device(): Promise<IosDeviceState> {
    return (await this.request('/device')).json() as Promise<IosDeviceState>
  }
}
