import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../../util/logger.js'
import streamutil from '../../../../util/streamutil.js'
import type {Adb, DevicePluginOptions} from '../../../../types/device-plugins.js'
import adbSyrup from '../../support/adb.js'

export interface HwProbeResult {
  ram: number | null
  rom: number | null
  cpuCores: number | null
  cpuFreq: number | null
  socModel: string | null
  socManufacturer: string | null
  marketName: string | null
  buildDateUtc: number | null
  buildDate: string | null
}

const STORAGE_TIERS_GB = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]

export const PROBE_COMMAND = [
  'echo "===MEMINFO==="'
, 'cat /proc/meminfo 2>/dev/null || true'
, 'echo "===DF_DATA==="'
, 'df -k /data 2>/dev/null || true'
, 'echo "===CPU_PRESENT==="'
, 'cat /sys/devices/system/cpu/present 2>/dev/null || true'
, 'echo "===CPU_FREQ==="'
, 'cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null || ' +
  'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq 2>/dev/null || true'
, 'echo "===SOC_MODEL==="'
, 'getprop ro.soc.model 2>/dev/null || true'
, 'echo "===SOC_MANUFACTURER==="'
, 'getprop ro.soc.manufacturer 2>/dev/null || true'
, 'echo "===MARKETNAME==="'
, 'getprop ro.product.marketname 2>/dev/null || true'
, 'echo "===BUILD_DATE_UTC==="'
, 'getprop ro.build.date.utc 2>/dev/null || true'
].join('; ')

export function emptyHwProbeResult(): HwProbeResult {
  return {
    ram: null
  , rom: null
  , cpuCores: null
  , cpuFreq: null
  , socModel: null
  , socManufacturer: null
  , marketName: null
  , buildDateUtc: null
  , buildDate: null
  }
}

export function parseMemTotalMb(text: string): number | null {
  const match = /^\s*MemTotal:\s*(\d+)\s*([a-zA-Z]*)/m.exec(text)
  if (!match) {
    return null
  }
  const rawValue = parseInt(match[1]!, 10)
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return null
  }
  const unit = (match[2] || 'kb').toLowerCase()
  let mb: number
  if (unit === 'b') {
    mb = Math.round(rawValue / (1024 * 1024))
  }
  else if (unit === 'mb') {
    mb = Math.round(rawValue)
  }
  else if (unit === 'gb') {
    mb = Math.round(rawValue * 1024)
  }
  else {
    mb = Math.round(rawValue / 1024)
  }
  return mb > 0 ? mb : null
}

export function roundStorageTierGb(blocks1k: number): number | null {
  if (!Number.isFinite(blocks1k) || blocks1k <= 0) {
    return null
  }
  const rawGiB = blocks1k / (1024 * 1024)
  for (let i = 0; i < STORAGE_TIERS_GB.length; i++) {
    const tier = STORAGE_TIERS_GB[i]!
    if (rawGiB <= tier * 1.02) {
      return tier
    }
  }
  const exactGb = Math.round(rawGiB)
  return exactGb > 0 ? exactGb : 1
}

export function parseDataRomGb(text: string): number | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let fallbackBlocks: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line && !/^Filesystem\b/i.test(line)) {
      const match = /(\d+)\s+\d+\s+\d+\s+(?:\d+%|-)\s+(\/\S*)\s*$/.exec(line)
      if (match) {
        const blocks = parseInt(match[1]!, 10)
        const mountPoint = match[2]!
        if (blocks > 0) {
          if (mountPoint === '/data') {
            return roundStorageTierGb(blocks)
          }
          if (fallbackBlocks === null) {
            fallbackBlocks = blocks
          }
        }
      }
    }
  }

  return fallbackBlocks !== null ? roundStorageTierGb(fallbackBlocks) : null
}

export function parseCpuPresent(text: string): number | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(line)) {
      const ranges = line.split(',')
      let total = 0
      let valid = true
      for (let j = 0; j < ranges.length; j++) {
        const part = ranges[j]!
        const dash = part.indexOf('-')
        if (dash === -1) {
          total += 1
        }
        else {
          const start = parseInt(part.slice(0, dash), 10)
          const end = parseInt(part.slice(dash + 1), 10)
          if (end < start) {
            valid = false
            break
          }
          total += end - start + 1
        }
      }
      if (valid && total > 0) {
        return total
      }
    }
  }
  return null
}

export function parseCpuMaxFreqGhz(text: string): number | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let maxKhz = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (/^\d+$/.test(line)) {
      const khz = parseInt(line, 10)
      if (khz > maxKhz) {
        maxKhz = khz
      }
    }
  }
  if (maxKhz <= 0) {
    return null
  }
  const ghz = Math.round((maxKhz / 1000000) * 100) / 100
  return ghz > 0 ? ghz : null
}

function cleanProp(text: string, rejectUnknown: boolean): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    const isError = /permission denied|not found|inaccessible/i.test(trimmed)
    const isUnknown = rejectUnknown && trimmed.toLowerCase() === 'unknown'
    if (trimmed && !isError && !isUnknown) {
      return trimmed
    }
  }
  return null
}

export function parseBuildDateUtc(
  text: string
): {buildDateUtc: number | null, buildDate: string | null} {
  const raw = cleanProp(text, true)
  if (!raw || !/^\d+$/.test(raw)) {
    return {buildDateUtc: null, buildDate: null}
  }
  const utc = parseInt(raw, 10)
  if (!Number.isFinite(utc) || utc <= 0) {
    return {buildDateUtc: null, buildDate: null}
  }
  const date = new Date(utc * 1000)
  if (Number.isNaN(date.getTime())) {
    return {buildDateUtc: null, buildDate: null}
  }
  return {
    buildDateUtc: utc
  , buildDate: date.toISOString().slice(0, 10)
  }
}

function splitSections(raw: string): Record<string, string> {
  const normalized = raw.replace(/\r\n/g, '\n')
  const sections: Record<string, string> = Object.create(null)
  const parts = normalized.split(/[=]==([A-Z0-9_]+)===/)
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const key = parts[i]!
    const body = parts[i + 1]!
    sections[key] = body
  }
  return sections
}

export function parseHwProbeOutput(raw: string): HwProbeResult {
  if (!raw || typeof raw !== 'string') {
    return emptyHwProbeResult()
  }
  const sections = splitSections(raw)
  if (Object.keys(sections).length === 0) {
    return {
      ram: parseMemTotalMb(raw)
    , rom: parseDataRomGb(raw)
    , cpuCores: null
    , cpuFreq: null
    , socModel: null
    , socManufacturer: null
    , marketName: null
    , buildDateUtc: null
    , buildDate: null
    }
  }
  const parsedDate = parseBuildDateUtc(sections.BUILD_DATE_UTC || '')
  return {
    ram: parseMemTotalMb(sections.MEMINFO || '')
  , rom: parseDataRomGb(sections.DF_DATA || '')
  , cpuCores: parseCpuPresent(sections.CPU_PRESENT || '')
  , cpuFreq: parseCpuMaxFreqGhz(sections.CPU_FREQ || '')
  , socModel: cleanProp(sections.SOC_MODEL || '', true)
  , socManufacturer: cleanProp(sections.SOC_MANUFACTURER || '', true)
  , marketName: cleanProp(sections.MARKETNAME || '', true)
  , buildDateUtc: parsedDate.buildDateUtc
  , buildDate: parsedDate.buildDate
  }
}

export default syrup.serial()
  .dependency(adbSyrup)
  .define(function(options: DevicePluginOptions, adb: Adb): Promise<HwProbeResult> {
    const log = logger.createLogger('device:plugins:hwprobe')

    function probe(): Promise<HwProbeResult> {
      log.info('Probing device hardware')
      return Promise.try(function() {
        return adb.shell(options.serial, PROBE_COMMAND)
      })
        .timeout(10000)
        .then(function(out) {
          return streamutil.readAll(out)
            .timeout(10000)
        })
        .then(function(buffer) {
          return parseHwProbeOutput(buffer.toString('utf8'))
        })
        .catch(function(err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          log.warn('Unable to complete hardware probe: %s', message)
          return emptyHwProbeResult()
        })
    }

    return probe()
  })
