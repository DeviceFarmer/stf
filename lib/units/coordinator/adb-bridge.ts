import net from 'node:net'
import type {Duplex} from 'node:stream'
import {CoordinatorError} from './config.js'

export interface AdbTarget {
  leaseId: string
  serial: string
  host: string
  port: number
}

const MAX_REQUEST = 65535
const FEATURES = 'cmd,shell_v2'

export function adbRequest(value: string) {
  const body = Buffer.from(value)
  if (!body.length || body.length > MAX_REQUEST) {
    throw new Error('Invalid ADB request length')
  }
  return Buffer.concat([Buffer.from(body.length.toString(16).padStart(4, '0')), body])
}

export async function readAdbBytes(
  stream: Duplex, count: number, timeoutMs = 10000
): Promise<Buffer> {
  let size = 0
  const chunks: Buffer[] = []
  while (size < count) {
    const remaining = count - size
    const available = Math.min(remaining, stream.readableLength || remaining)
    const part = stream.read(available) as Buffer | null
    if (part) {
      chunks.push(part)
      size += part.length
      continue
    }
    if (stream.destroyed || stream.readableEnded) {
      throw new Error('ADB connection ended before its response')
    }
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        stream.off('readable', readable)
        stream.off('error', failed)
        stream.off('end', ended)
        stream.off('close', ended)
        if (error) {
          reject(error)
        }
        else {
          resolve()
        }
      }
      const readable = () => finish()
      const failed = (error: Error) => finish(error)
      const ended = () => finish(new Error('ADB connection ended'))
      const timer = setTimeout(() => finish(new Error('ADB response timed out')), timeoutMs)
      timer.unref?.()
      stream.once('readable', readable)
      stream.once('error', failed)
      stream.once('end', ended)
      stream.once('close', ended)
    })
  }
  return Buffer.concat(chunks, count)
}

async function readRequest(stream: Duplex) {
  const header = (await readAdbBytes(stream, 4)).toString('ascii')
  if (!/^[0-9a-fA-F]{4}$/.test(header)) {
    throw new Error('Invalid ADB request header')
  }
  const length = parseInt(header, 16)
  if (!length) {
    throw new Error('Empty ADB request')
  }
  const body = await readAdbBytes(stream, length)
  // A malformed UTF-8 service must not become a different request after decoding.
  const value = new TextDecoder('utf-8', {fatal: true}).decode(body)
  const shell = /^shell(?:,[A-Za-z0-9_=./-]+(?:,[A-Za-z0-9_=./-]+)*)?:/.exec(value)
  // Maestro starts instrumentation with a background command followed by a newline.
  // Whitespace belongs only to the shell body; host selectors and service prefixes stay strict.
  if ([...value].some((character, index) => {
    const code = character.charCodeAt(0)
    if (code >= 32 && code !== 127) {
      return false
    }
    return !shell || index < shell[0].length || ![9, 10, 13].includes(code)
  })) {
    throw new Error('Invalid ADB request')
  }
  return value
}

async function expectOkay(stream: Duplex) {
  if ((await readAdbBytes(stream, 4)).toString() !== 'OKAY') {
    throw new Error('ADB server rejected the allocated device or service')
  }
}

/** Only the trusted coordinator may contact the pool ADB server. */
export async function openAdbService(target: AdbTarget, service: string): Promise<net.Socket> {
  const socket = net.createConnection({host: target.host, port: target.port})
  socket.on('error', () => {})
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
 socket.destroy(); reject(new Error('ADB connect timed out'))
}, 10000)
      timer.unref?.()
      socket.once('connect', () => {
 clearTimeout(timer); resolve()
})
      socket.once('error', error => {
 clearTimeout(timer); reject(error)
})
    })
    socket.write(adbRequest('host:transport:' + target.serial))
    await expectOkay(socket)
    socket.write(adbRequest(service))
    await expectOkay(socket)
    return socket
  }
  catch (error) {
    socket.destroy()
    throw error
  }
}

function allowedService(value: string) {
  return /^shell(?:,[A-Za-z0-9_=./-]+(?:,[A-Za-z0-9_=./-]+)*)?:/.test(value) ||
    value.startsWith('exec:') || value === 'sync:' ||
    /^(?:localabstract|localreserved|localfilesystem):.+$/.test(value) ||
    /^tcp:([1-9][0-9]{0,4})$/.test(value) && Number(value.slice(4)) <= 65535
}

function valueResponse(value: string) {
  return Buffer.concat([Buffer.from('OKAY'), adbRequest(value)])
}

/** A smart-socket facade for one lease; never forwards host-global ADB requests. */
export class LeaseAdbBridge {
  private readonly streams = new Map<string, Set<Duplex>>()
  private closed = false

  accept(stream: Duplex, target: AdbTarget, assertActive: () => void | Promise<void>) {
    // Rejected admission also destroys a stream with an error; install its handler first.
    stream.on('error', () => {})
    const current = this.streams.get(target.leaseId) || new Set<Duplex>()
    const total = [...this.streams.values()].reduce((sum, set) => sum + set.size, 0)
    if (this.closed || current.size >= 32 || total >= 128) {
      stream.destroy(new Error('ADB connection limit reached'))
      return
    }
    current.add(stream)
    this.streams.set(target.leaseId, current)
    const check = setInterval(() => {
      Promise.resolve().then(assertActive).catch(() => stream.destroy())
    }, 1000)
    check.unref?.()
    stream.once('close', () => {
      clearInterval(check)
      current.delete(stream)
      if (!current.size) {
 this.streams.delete(target.leaseId)
}
    })
    this.serve(stream, target, assertActive).catch(() => {
      if (!stream.destroyed) {
        stream.end(Buffer.concat([Buffer.from('FAIL'), adbRequest('Lease ADB request rejected')]))
      }
    })
  }

  closeLease(id: string) {
    const streams = this.streams.get(id)
    this.streams.delete(id)
    for (const stream of streams || []) {
 stream.destroy()
}
  }

  close() {
    this.closed = true
    for (const id of this.streams.keys()) {
 this.closeLease(id)
}
  }

  private async serve(stream: Duplex, target: AdbTarget, assertActive: () => void | Promise<void>) {
    let selected = false
    // There is at most one selection and one service per connection.
    for (let requestNumber = 0; requestNumber < 2; requestNumber++) {
      await assertActive()
      const request = await readRequest(stream)
      await assertActive()
      if (!selected && request === 'host:version') {
        stream.end(valueResponse('0029'))
        return
      }
      if (!selected && ['host:devices', 'host:devices-l'].includes(request)) {
        stream.end(valueResponse(target.serial + '\tdevice\n'))
        return
      }
      if (request === 'host:features' || !selected &&
          request === `host-serial:${target.serial}:features`) {
        stream.end(valueResponse(FEATURES))
        return
      }
      if (!selected && request === `host-serial:${target.serial}:get-state`) {
        stream.end(valueResponse('device'))
        return
      }
      if (!selected && request === 'host:transport:' + target.serial) {
        selected = true
        stream.write('OKAY')
        continue
      }
      if (!selected && request === 'host:tport:serial:' + target.serial) {
        selected = true
        const id = Buffer.alloc(8)
        id.writeBigUInt64LE(1n)
        stream.write(Buffer.concat([Buffer.from('OKAY'), id]))
        continue
      }
      if (!selected || !allowedService(request)) {
        throw new CoordinatorError(403, 'adb_service_denied', 'ADB service is not allowed')
      }
      const upstream = await openAdbService(target, request)
      try {
        await assertActive()
        if (stream.destroyed) {
 throw new Error('Client disconnected during ADB startup')
}
      }
      catch (error) {
        upstream.destroy()
        throw error
      }
      stream.once('close', () => upstream.destroy())
      stream.once('error', () => upstream.destroy())
      upstream.once('close', () => {
 if (!upstream.readableEnded) {
 stream.destroy()
}
})
      upstream.once('error', () => stream.destroy())
      stream.write('OKAY')
      // Node streams preserve bounded backpressure in both directions, including sync/APK data.
      stream.pipe(upstream)
      upstream.pipe(stream)
      return
    }
    throw new Error('Too many ADB requests')
  }
}
