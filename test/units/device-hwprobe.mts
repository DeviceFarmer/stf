import {Readable} from 'node:stream'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'
import Promise from 'bluebird'
import sinon from 'sinon'
import deviceData from '@devicefarmer/stf-device-db'

import logger from '../../lib/util/logger.js'
import hwprobeSyrup, {
  PROBE_COMMAND
, emptyHwProbeResult
, parseCpuMaxFreqGhz
, parseCpuPresent
, parseDataRomGb
, parseHwProbeOutput
, parseMemTotalMb
, roundStorageTierGb
} from '../../lib/units/device/plugins/util/hwprobe.js'
import dataSyrup, {
  mergeDeviceData
, populateImageSlug
} from '../../lib/units/device/plugins/util/data.js'
import identitySyrup from '../../lib/units/device/plugins/util/identity.js'
import type {
  DeviceDisplay
, DeviceIdentity
, DevicePluginOptions
} from '../../lib/types/device-plugins.js'

function shellStream(text: string): Readable {
  const out = new Readable()
  out._read = function() {
    out.push(Buffer.from(text))
    out.push(null)
  }
  return out
}

function errorStream(err: Error): Readable {
  const out = new Readable()
  out._read = function() {
    process.nextTick(function() {
      out.destroy(err)
    })
  }
  return out
}

const ANDROID_8_SAMPLE = [
  '===MEMINFO==='
, 'MemTotal:        3754832 kB'
, 'MemFree:          142356 kB'
, 'MemAvailable:    1684212 kB'
, '===DF_DATA==='
, 'Filesystem                                       1K-blocks     Used Available Use% Mounted on'
, '/dev/block/platform/soc/1d84000.ufshc/by-name/userdata'
, '                                                  54945772 18234112  36711660  34% /data'
, '===CPU_PRESENT==='
, '0-7'
, '===CPU_FREQ==='
, '1900800'
, '1900800'
, '1900800'
, '1900800'
, '2457600'
, '2457600'
, '2457600'
, '2457600'
, '===SOC_MODEL==='
, ''
, '===SOC_MANUFACTURER==='
, ''
, '===MARKETNAME==='
, ''
, '===BUILD_DATE_UTC==='
, '1538694120'
, ''
].join('\r\n')

const ANDROID_12_SAMPLE = [
  '===MEMINFO==='
, 'MemTotal:        7694520 kB'
, 'MemFree:          218432 kB'
, 'MemAvailable:    3812044 kB'
, '===DF_DATA==='
, 'Filesystem       1K-blocks     Used Available Use% Mounted on'
, '/dev/block/dm-5  115246208 24512384  90602752  22% /data'
, '===CPU_PRESENT==='
, '0-7'
, '===CPU_FREQ==='
, '1804800'
, '1804800'
, '1804800'
, '1804800'
, '2253000'
, '2253000'
, '2802000'
, '2802000'
, '===SOC_MODEL==='
, 'GS101'
, '===SOC_MANUFACTURER==='
, 'Google'
, '===MARKETNAME==='
, 'Pixel 6'
, '===BUILD_DATE_UTC==='
, '1643841200'
, ''
].join('\n')

const ANDROID_15_SAMPLE = [
  '===MEMINFO==='
, 'MemTotal:       15682944 kB'
, 'MemFree:          512880 kB'
, 'MemAvailable:    9142300 kB'
, '===DF_DATA==='
, 'Filesystem       1K-blocks     Used Available Use% Mounted on'
, '/dev/block/dm-52 236978144 38912040 196755384  17% /data'
, '===CPU_PRESENT==='
, '0-7'
, '===CPU_FREQ==='
, '1950000'
, '1950000'
, '1950000'
, '1950000'
, '2600000'
, '2600000'
, '2600000'
, '3105000'
, '===SOC_MODEL==='
, 'Tensor G4'
, '===SOC_MANUFACTURER==='
, 'Google'
, '===MARKETNAME==='
, 'Pixel 9 Pro'
, '===BUILD_DATE_UTC==='
, '1723680000'
, ''
].join('\n')

function baseIdentity(overrides: Partial<DeviceIdentity> = {}): DeviceIdentity {
  return Object.assign({
    serial: 'proto-serial-1'
  , platform: 'Android'
  , manufacturer: 'GOOGLE'
  , operator: null
  , model: 'Proto-X1'
  , version: '15'
  , abi: 'arm64-v8a'
  , sdk: '35'
  , product: 'proto_x1'
  , cpuPlatform: 'zuma_pro'
  , openGLESVersion: '3.2'
  , marketName: 'Proto-X1'
  , display: {
      id: 0
    , width: 1080
    , height: 2400
    , xdpi: 420
    , ydpi: 420
    , fps: 120
    , density: 3
    , rotation: 0
    , secure: true
    , size: 6.3
    }
  , phone: {}
  }, overrides)
}

const dummyOptions = {serial: 'proto-serial-1'} as DevicePluginOptions

describe('device hardware probe (hwprobe)', function() {
  afterEach(function() {
    sinon.restore()
  })

  it('parses Android 8 shell output with CRLF endings, wrapped df, and missing SoC props',
    function() {
      const parsed = parseHwProbeOutput(ANDROID_8_SAMPLE)
      expect(parsed).to.deep.equal({
        ram: 3667
      , rom: 64
      , cpuCores: 8
      , cpuFreq: 2.46
      , socModel: null
      , socManufacturer: null
      , marketName: null
      , buildDateUtc: 1538694120
      , buildDate: '2018-10-04'
      })
    })

  it('parses Android 12 shell output with Tensor SoC, marketname, and 128 GB storage',
    function() {
      const parsed = parseHwProbeOutput(ANDROID_12_SAMPLE)
      expect(parsed).to.deep.equal({
        ram: 7514
      , rom: 128
      , cpuCores: 8
      , cpuFreq: 2.8
      , socModel: 'GS101'
      , socManufacturer: 'Google'
      , marketName: 'Pixel 6'
      , buildDateUtc: 1643841200
      , buildDate: '2022-02-02'
      })
    })

  it('parses Android 15 shell output with 16 GB RAM, 256 GB storage, and tri-cluster CPU',
    function() {
      const parsed = parseHwProbeOutput(ANDROID_15_SAMPLE)
      expect(parsed).to.deep.equal({
        ram: 15315
      , rom: 256
      , cpuCores: 8
      , cpuFreq: 3.11
      , socModel: 'Tensor G4'
      , socManufacturer: 'Google'
      , marketName: 'Pixel 9 Pro'
      , buildDateUtc: 1723680000
      , buildDate: '2024-08-15'
      })
    })

  it('handles CPU present masks, storage tiers, and exact GB above standard tiers', function() {
    expect(parseCpuPresent('0')).to.equal(1)
    expect(parseCpuPresent('0-9')).to.equal(10)
    expect(parseCpuPresent('0-3,6-7')).to.equal(6)
    expect(parseCpuPresent('')).to.equal(null)
    expect(parseCpuMaxFreqGhz('')).to.equal(null)
    expect(parseMemTotalMb('MemFree: 1024 kB')).to.equal(null)
    expect(parseDataRomGb('Filesystem 1K-blocks Used Available Use% Mounted on')).to.equal(null)
    expect(roundStorageTierGb(475000000)).to.equal(512)
    expect(roundStorageTierGb(950000000)).to.equal(1024)
    expect(roundStorageTierGb(3145728000)).to.equal(3000)
  })

  it('returns partial results without throwing on locked-down devices', async function() {
    const lockedDownOutput = [
      '===MEMINFO==='
    , 'MemTotal:        5824112 kB'
    , '===DF_DATA==='
    , '===CPU_PRESENT==='
    , '0-5'
    , '===CPU_FREQ==='
    , '===SOC_MODEL==='
    , 'unknown'
    , '===SOC_MANUFACTURER==='
    , 'Qualcomm'
    , '===MARKETNAME==='
    , ''
    , '===BUILD_DATE_UTC==='
    , '1700000000'
    ].join('\n')

    const adb = {
      shell: sinon.stub().resolves(shellStream(lockedDownOutput))
    }

    const res = await hwprobeSyrup.invoke(dummyOptions, adb)
    expect(adb.shell.calledOnce).to.equal(true)
    expect(adb.shell.firstCall.args[0]).to.equal('proto-serial-1')
    expect(adb.shell.firstCall.args[1]).to.equal(PROBE_COMMAND)
    expect(res).to.deep.equal({
      ram: 5688
    , rom: null
    , cpuCores: 6
    , cpuFreq: null
    , socModel: null
    , socManufacturer: 'Qualcomm'
    , marketName: null
    , buildDateUtc: 1700000000
    , buildDate: '2023-11-14'
    })
  })

  it('never throws when adb.shell rejects or the shell stream errors', async function() {
    const rejectingAdb = {
      shell: sinon.stub().returns(Promise.reject(new Error('device offline')))
    }
    const r1 = await hwprobeSyrup.invoke(dummyOptions, rejectingAdb)
    expect(r1).to.deep.equal(emptyHwProbeResult())

    const streamErrAdb = {
      shell: sinon.stub().resolves(errorStream(new Error('SELinux stream closed')))
    }
    const r2 = await hwprobeSyrup.invoke(dummyOptions, streamErrAdb)
    expect(r2).to.deep.equal(emptyHwProbeResult())
  })

  it('executes PROBE_COMMAND cleanly in a POSIX shell when paths are missing', function() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-hwprobe-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'getprop')
      , '#!/bin/sh\n' +
        'case "$1" in\n' +
        '  ro.soc.model) echo "SM8650" ;;\n' +
        '  ro.soc.manufacturer) echo "Qualcomm" ;;\n' +
        '  ro.product.marketname) echo "OnePlus 12" ;;\n' +
        '  ro.build.date.utc) echo "1710000000" ;;\n' +
        'esac\n'
      , {mode: 0o755}
      )
      const proc = childProcess.spawnSync('/bin/sh', ['-c', PROBE_COMMAND], {
        env: Object.assign({}, process.env, {
          PATH: dir + path.delimiter + process.env.PATH
        })
      , encoding: 'utf8'
      })
      expect(proc.status).to.equal(0)
      const parsed = parseHwProbeOutput(proc.stdout)
      expect(parsed.socModel).to.equal('SM8650')
      expect(parsed.socManufacturer).to.equal('Qualcomm')
      expect(parsed.marketName).to.equal('OnePlus 12')
      expect(parsed.buildDate).to.equal('2024-03-09')
    }
    finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('device data and identity metadata resolution', function() {
  afterEach(function() {
    sinon.restore()
  })

  it('merges live hwprobe metrics with static DB SoC name, marketName fallback, and release date',
    function() {
      const findStub = sinon.stub(deviceData, 'find').returns({
        name: {id: 'Galaxy A55 5G', long: 'Samsung Galaxy A55 5G'}
      , brand: 'Samsung'
      , marketName: 'Galaxy A55 5G'
      , date: '2024-03-11'
      , cpu: {name: 'Exynos 1480', cores: 8, freq: 2.75}
      , memory: {ram: 8192, rom: 128}
      , image: 'samsung_galaxy_a55_5g'
      })

      const identity = baseIdentity({
        manufacturer: 'SAMSUNG'
      , model: 'SM-A556E'
      , product: 'a55xnsxx'
      , marketName: 'SM-A556E'
      , sdk: '34'
      , display: {
          id: 0
        , width: 1080
        , height: 2340
        , xdpi: 411
        , ydpi: 411
        , fps: 120
        , density: 2.8125
        , rotation: 0
        , secure: true
        , size: 6.6
        }
      })

      const probe = {
        ram: 11642
      , rom: 256
      , cpuCores: 8
      , cpuFreq: 2.75
      , socModel: 's5e8845'
      , socManufacturer: 'Samsung'
      , marketName: null
      , buildDateUtc: 1720000000
      , buildDate: '2024-07-03'
      }

      const result = dataSyrup.invoke(dummyOptions, identity, probe)
      expect(findStub.calledOnceWithExactly({
        model: 'SM-A556E'
      , name: 'a55xnsxx'
      , manufacturer: 'SAMSUNG'
      , platform: 'Android'
      })).to.equal(true)

      expect(result).to.deep.equal({
        name: {id: 'Galaxy A55 5G', long: 'Samsung Galaxy A55 5G'}
      , brand: 'Samsung'
      , marketName: 'Galaxy A55 5G'
      , date: '2024-03-11'
      , cpu: {name: 'Exynos 1480', cores: 8, freq: 2.75}
      , memory: {ram: 11642, rom: 256}
      , image: 'galaxy-a55-v2.webp?w=1080&h=2340&xd=411&yd=411&sdk=34'
      })
    })

  it('builds a complete payload for an unreleased prototype without logging a warning',
    function() {
      const warnSpy = sinon.spy()
      sinon.stub(logger, 'createLogger').returns({
        info: sinon.spy()
      , warn: warnSpy
      , error: sinon.spy()
      , debug: sinon.spy()
      } as unknown as ReturnType<typeof logger.createLogger>)
      sinon.stub(deviceData, 'find').returns(null)

      const identity = baseIdentity({
        manufacturer: 'QUALCOMM'
      , model: 'QRD-SM8750'
      , product: 'sun_qrd'
      , marketName: 'QRD-SM8750'
      , sdk: '35'
      })

      const probe = {
        ram: 15420
      , rom: 512
      , cpuCores: 8
      , cpuFreq: 4.32
      , socModel: 'SM8750'
      , socManufacturer: 'Qualcomm'
      , marketName: 'Snapdragon 8 Elite QRD'
      , buildDateUtc: 1729555200
      , buildDate: '2024-10-22'
      }

      const result = dataSyrup.invoke(dummyOptions, identity, probe)
      expect(warnSpy.called).to.equal(false)
      expect(result).to.deep.equal({
        name: {
          id: 'Snapdragon 8 Elite QRD'
        , long: 'QUALCOMM Snapdragon 8 Elite QRD'
        }
      , brand: 'QUALCOMM'
      , marketName: 'Snapdragon 8 Elite QRD'
      , date: '2024-10-22'
      , cpu: {
          name: 'Qualcomm SM8750'
        , cores: 8
        , freq: 4.32
        }
      , memory: {
          ram: 15420
        , rom: 512
        }
      , image: 'generic-phone-v1.svg?w=1080&h=2400&xd=420&yd=420&sdk=35'
      })
    })

  it('falls back to static DB hardware values when live hwprobe fields are null', function() {
    const merged = mergeDeviceData(
      baseIdentity({model: 'Pixel 8', product: 'shiba', sdk: '34'})
    , emptyHwProbeResult()
    , {
        name: {id: 'Pixel 8', long: 'Google Pixel 8'}
      , brand: 'Google'
      , marketName: 'Pixel 8'
      , date: '2023-10-12'
      , cpu: {name: 'Google Tensor G3', cores: 9, freq: 3}
      , memory: {ram: 8192, rom: 128}
      , image: 'google_pixel_8'
      }
    )

    expect(merged.cpu).to.deep.equal({name: 'Google Tensor G3', cores: 9, freq: 3})
    expect(merged.memory).to.deep.equal({ram: 8192, rom: 128})
    expect(merged.date).to.equal('2023-10-12')
    expect(populateImageSlug(null, {display: baseIdentity().display, sdk: '35'}))
      .to.equal('generic-phone-v1.svg?w=1080&h=2400&xd=420&yd=420&sdk=35')
    expect(populateImageSlug(null, {
      display: Object.assign({}, baseIdentity().display, {xdpi: 0, ydpi: 0, density: 3})
    , sdk: '35'
    })).to.equal('generic-phone-v1.svg?w=1080&h=2400&dpi=480&sdk=35')
  })

  it('resolves identity.marketName from debug override, live hwprobe, or static DB', function() {
    sinon.stub(deviceData, 'find').returns({
      name: {id: 'Galaxy A55 5G', long: 'Samsung Galaxy A55 5G'}
    , brand: 'Samsung'
    , marketName: 'Galaxy A55 5G'
    , date: '2024-03-11'
    , cpu: null
    , memory: null
    , image: 'galaxy-a55'
    })

    const display = {properties: baseIdentity().display} as DeviceDisplay
    const baseProps = {
      'ro.product.model': 'SM-A556E'
    , 'ro.product.manufacturer': 'samsung'
    , 'ro.product.name': 'a55xnsxx'
    , 'ro.product.device': 'a55x'
    , 'ro.opengles.version': '196610'
    }

    const fromDb = identitySyrup.invoke(
      dummyOptions
    , baseProps
    , display
    , {}
    , emptyHwProbeResult()
    )
    expect(fromDb.marketName).to.equal('Galaxy A55 5G')

    const fromProbe = identitySyrup.invoke(
      dummyOptions
    , baseProps
    , display
    , {}
    , Object.assign(emptyHwProbeResult(), {marketName: 'Live Market Name'})
    )
    expect(fromProbe.marketName).to.equal('Live Market Name')

    const fromDebug = identitySyrup.invoke(
      dummyOptions
    , Object.assign({}, baseProps, {'debug.stf.product.device': 'Custom Bench Label'})
    , display
    , {}
    , Object.assign(emptyHwProbeResult(), {marketName: 'Live Market Name'})
    )
    expect(fromDebug.marketName).to.equal('Custom Bench Label')
  })
})
