import {readFile} from 'node:fs/promises'
import path from 'node:path'
import type {AdbPool, CoordinatorOptions} from './types.js'

export class CoordinatorError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export function endpoint(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) {
    throw new Error('Expected an HTTP(S) URL without credentials, query or fragment')
  }
  return value.replace(/\/+$/, '')
}

export async function secret(file: string): Promise<string> {
  const value = (await readFile(file, 'utf8')).trim()
  if (value.length < 24 || /\s/.test(value)) {
    throw new Error('Coordinator token files must contain at least 24 non-whitespace characters')
  }
  return value
}

export async function validateOptions(options: CoordinatorOptions): Promise<AdbPool[]> {
  for (const key of ['port', 'leaseTtlSeconds', 'heartbeatIntervalSeconds', 'pollIntervalSeconds'
    , 'maxDurationSeconds', 'maxParallel', 'upstreamTimeoutSeconds'] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) {
      throw new Error(`${key} must be a positive integer`)
    }
  }
  if (options.port > 65535 || options.heartbeatIntervalSeconds >= options.leaseTtlSeconds ||
      options.leaseTtlSeconds > 3600 || options.maxDurationSeconds > 86400 ||
      options.upstreamTimeoutSeconds > 300) {
    throw new Error('Invalid coordinator port or timeout relationship')
  }
  endpoint(options.publicUrl)
  endpoint(options.stfApiUrl)
  if (typeof options.appiumGridUrl !== 'undefined') {
    endpoint(options.appiumGridUrl)
  }
  if (!path.isAbsolute(options.stateFile)) {
    throw new Error('stateFile must be an absolute path on persistent storage')
  }
  const pools: unknown = JSON.parse(await readFile(options.adbPoolsFile, 'utf8'))
  if (!Array.isArray(pools)) {
    throw new Error('ADB pools must be a JSON array')
  }
  const providers = new Set<string>()
  const ports = new Set<string>()
  for (const pool of pools as AdbPool[]) {
    if (!pool || typeof pool.provider !== 'string' || !pool.provider ||
        typeof pool.host !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(pool.host) ||
        !Number.isInteger(pool.port) || pool.port < 1 || pool.port > 65535 ||
        !Array.isArray(pool.systemPorts) ||
        providers.has(pool.provider)) {
      throw new Error('Invalid or duplicate ADB pool configuration')
    }
    providers.add(pool.provider)
    for (const port of pool.systemPorts) {
      const key = `${pool.host}:${port}`
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || ports.has(key)) {
        throw new Error('Invalid or overlapping ADB systemPort range')
      }
      ports.add(key)
    }
  }
  return pools as AdbPool[]
}
