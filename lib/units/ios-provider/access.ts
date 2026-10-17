import type {IncomingHttpHeaders} from 'node:http'

export interface IosOwner {
  email: string
  name: string
  group: string
}

export async function authorizeScreen(
  apiUrl: string
, publicOrigin: string
, serial: string
, owner: IosOwner | null
, headers: IncomingHttpHeaders
): Promise<boolean> {
  if (!owner || (headers.origin !== publicOrigin &&
      !(headers.origin === undefined && headers.authorization?.startsWith('Bearer ')))) {
    return false
  }
  const credentials: Record<string, string> = {}
  if (headers.cookie) {
    credentials.Cookie = headers.cookie
  }
  if (headers.authorization) {
    credentials.Authorization = headers.authorization
  }
  if (!Object.keys(credentials).length) {
    return false
  }
  try {
    const identity = await fetch(new URL('/api/v1/user', apiUrl), {
      headers: credentials, signal: AbortSignal.timeout(5000), redirect: 'error'
    })
    if (!identity.ok) {
      await identity.body?.cancel()
      return false
    }
    const viewer = await identity.json() as {success?: boolean, user?: {email?: string}}
    if (viewer.success !== true || viewer.user?.email !== owner.email) {
      return false
    }
    const url = new URL('/api/v1/user/devices/' + encodeURIComponent(serial), apiUrl)
    const signal = AbortSignal.timeout(5000)
    let response: Response | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(url, {headers: credentials, signal, redirect: 'error'})
      if (response.ok) {
        break
      }
      await response.body?.cancel()
      if (response.status !== 403 || attempt === 3) {
        return false
      }
      // The wire join reply can arrive just before the processor persists its owner.
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const body = await response!.json() as {
      success?: boolean, device?: {serial?: string, owner?: {email?: string}}
    }
    return body.success === true && body.device?.serial === serial &&
      body.device.owner?.email === owner.email
  }
  catch {
    return false
  }
}
