import {timingSafeEqual} from 'node:crypto'
import http from 'node:http'
import {pipeline} from 'node:stream'

import type {IosRuntime} from './runtime.mts'
import {InstallError, type Installations} from './installations.mts'

class InputError extends Error {
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError('Expected a number between ' + min + ' and ' + max)
  }
  return value
}

function point(body: any): {x: number, y: number} {
  if (!body || typeof body !== 'object') {
    throw new InputError('Expected coordinates')
  }
  return {x: number(body.x, 0, 1), y: number(body.y, 0, 1)}
}

async function body(req: http.IncomingMessage): Promise<any> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new InputError('Content-Type must be application/json')
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    length += chunk.length
    if (length > 16384) {
      req.resume()
      throw new InputError('Request body exceeds 16 KiB')
    }
    chunks.push(chunk)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString())
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value
  }
  catch {
    throw new InputError('Expected a JSON object')
  }
}

export function createServer(
  runtime: IosRuntime, token: string, installations?: Installations
): http.Server {
  const expected = Buffer.from('Bearer ' + token)
  return http.createServer({requestTimeout: 15000}, async(req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(value))
    }
    const received = Buffer.from(req.headers.authorization || '')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      json(401, {error: 'unauthorized'})
      return
    }
    // This prototype is an API for explicit clients, never a cross-origin browser endpoint.
    if (req.headers.origin) {
      json(403, {error: 'browser_origin_not_allowed'})
      return
    }
    const route = req.method + ' ' + req.url
    try {
      if (route === 'GET /health') {
        json(200, {status: 'running'})
        return
      }
      if (route === 'GET /device') {
        json(200, {
          udid: runtime.options.udid, state: runtime.state, generation: runtime.generation
        , instance: runtime.instance
        , ios: runtime.telemetry.status
        , error: runtime.lastError, info: runtime.info
        })
        return
      }
      if (req.method === 'POST' && installations) {
        const handlers = {
          '/installations/start': (input: any) => installations.start(input)
        , '/installations/status': (input: any) => installations.status(input)
        , '/installations/keepalive': (input: any) => installations.keepalive(input)
        , '/installations/cancel': (input: any) => installations.cancel(input)
        }
        const handler = handlers[req.url as keyof typeof handlers]
        if (handler) {
          json(200, await handler(await body(req)))
          return
        }
      }
      if (runtime.state !== 'ready') {
        json(503, {error: 'device_not_ready', state: runtime.state})
        return
      }
      if (route === 'GET /screen') {
        const upstream = http.get('http://127.0.0.1:' + runtime.options.mjpegPort, stream => {
          const contentType = stream.headers['content-type'] || ''
          if (stream.statusCode !== 200 || !contentType.startsWith('multipart/x-mixed-replace')) {
            stream.resume()
            json(502, {error: 'invalid_mjpeg_response'})
            return
          }
          res.writeHead(200, {'Content-Type': contentType})
          pipeline(stream, res, () => null)
        })
        upstream.setTimeout(15000, () => upstream.destroy(new Error('MJPEG timeout')))
        upstream.on('error', () => {
          if (!res.headersSent && !res.destroyed) {
            json(502, {error: 'screen_unavailable'})
          }
          else {
            res.destroy()
          }
        })
        res.once('close', () => upstream.destroy())
        return
      }
      if (route === 'GET /screenshot') {
        const {value} = await runtime.execute(wda => wda.call('GET', '/screenshot'), true)
        if (typeof value !== 'string') {
          throw new Error('WDA did not return an image')
        }
        const image = Buffer.from(value, 'base64')
        let contentType = 'image/png'
        if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
          if (!image.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
            throw new Error('WDA returned an unsupported screenshot format; configure PNG or JPEG')
          }
          contentType = 'image/jpeg'
        }
        res.writeHead(200, {'Content-Type': contentType})
        res.end(image)
        return
      }
      if (req.method !== 'POST') {
        json(404, {error: 'not_found'})
        return
      }
      const input = await body(req)
      switch (req.url) {
      case '/lock': {
        const abort = new AbortController()
        res.once('close', () => {
          if (!res.writableEnded) {
            abort.abort()
          }
        })
        json(200, await runtime.lock(abort.signal))
        return
      }
      case '/power':
        if (!['reboot', 'shutdown'].includes(input.action)) {
          throw new InputError('action must be reboot or shutdown')
        }
        json(200, await runtime.power(input.action))
        return
      case '/unlock':
        json(200, await runtime.unlock())
        return
      case '/shake': {
        const abort = new AbortController()
        res.once('close', () => {
          if (!res.writableEnded) {
            abort.abort()
          }
        })
        await runtime.shake(abort.signal)
        break
      }
      case '/tap': {
        const position = point(input)
        await runtime.execute(wda => wda.gesture(position), true)
        break
      }
      case '/swipe': {
        const from = point(input.from)
        const to = point(input.to)
        const duration = number(input.durationMs ?? 500, 50, 5000)
        await runtime.execute(wda => wda.gesture(from, to, duration), true)
        break
      }
      case '/text':
        if (typeof input.text !== 'string' || input.text.length > 4096) {
          throw new InputError('text must be a string of at most 4096 characters')
        }
        await runtime.execute(wda => wda.call('POST', '/wda/keys', {value: [input.text]}), true)
        break
      case '/home':
        await runtime.execute(wda => wda.request('POST', '/wda/homescreen', {}), true)
        break
      case '/apps/activate':
        if (typeof input.bundleId !== 'string' || !/^[\w.-]{1,255}$/.test(input.bundleId)) {
          throw new InputError('bundleId must be an application identifier')
        }
        await runtime.execute(wda => wda.call('POST', '/wda/apps/activate', {
          bundleId: input.bundleId
        }))
        break
      default:
        json(404, {error: 'not_found'})
        return
      }
      json(200, {success: true})
    }
    catch (error) {
      let status = runtime.state === 'ready' ? 502 : 503
      if (error instanceof InputError) {
        status = 400
      }
      if (error instanceof InstallError) {
        status = error.status
      }
      json(status, {error: (error as Error).message})
    }
  })
}
