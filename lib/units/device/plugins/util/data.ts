import syrup from '@devicefarmer/stf-syrup'
import deviceData from '@devicefarmer/stf-device-db'

import logger from '../../../../util/logger.js'
import {findCatalogDevice} from '../../../../util/device-catalog.js'
import {fallbackDeviceImage} from '../../../../util/device-image-paths.js'
import type {
  DeviceData
, DeviceFlags
, DeviceIdentity
, DevicePluginOptions
, HwProbeResult
} from '../../../../types/device-plugins.js'
import identitySyrup from './identity.js'
import hwprobeSyrup, {emptyHwProbeResult} from './hwprobe.js'

function formatSocName(hwprobe: HwProbeResult): string | null {
  const mfg = hwprobe.socManufacturer ? hwprobe.socManufacturer.trim() : ''
  const model = hwprobe.socModel ? hwprobe.socModel.trim() : ''
  if (mfg && model) {
    if (model.toLowerCase().startsWith(mfg.toLowerCase())) {
      return model
    }
    return mfg + ' ' + model
  }
  if (model) {
    return model
  }
  if (mfg) {
    return mfg
  }
  return null
}

function formatLongName(brand: string, marketName: string): string {
  if (!brand) {
    return marketName
  }
  if (!marketName) {
    return brand
  }
  if (marketName.toLowerCase().startsWith(brand.toLowerCase())) {
    return marketName
  }
  return brand + ' ' + marketName
}

export function populateImageSlug(
  baseImage: string | null | undefined
, identity: Pick<DeviceIdentity, 'display' | 'sdk'>
): string {
  const rawBase = baseImage && baseImage.trim() ? baseImage.trim() : fallbackDeviceImage
  const qIndex = rawBase.indexOf('?')
  const pathPart = qIndex === -1 ? rawBase : rawBase.slice(0, qIndex)
  const params = new URLSearchParams(qIndex === -1 ? '' : rawBase.slice(qIndex + 1))

  const display = identity.display
  if (display) {
    if (display.width > 0 && !params.has('w')) {
      params.set('w', String(display.width))
    }
    if (display.height > 0 && !params.has('h')) {
      params.set('h', String(display.height))
    }
    if (display.xdpi > 0 && !params.has('xd')) {
      params.set('xd', String(display.xdpi))
    }
    if (display.ydpi > 0 && !params.has('yd')) {
      params.set('yd', String(display.ydpi))
    }
    if (!(display.xdpi > 0) && !(display.ydpi > 0) && display.density > 0 && !params.has('dpi')) {
      params.set('dpi', String(Math.round(display.density * 160)))
    }
  }
  if (identity.sdk && String(identity.sdk).trim() && !params.has('sdk')) {
    params.set('sdk', String(identity.sdk).trim())
  }

  const query = params.toString()
  return query ? pathPart + '?' + query : pathPart
}

type DbMatchInput = (deviceData.DeviceRecord & {flags?: DeviceFlags}) | null

export function mergeDeviceData(
  identity: DeviceIdentity
, hwprobe: HwProbeResult | null | undefined
, dbMatch: DbMatchInput
): DeviceData {
  const probe = hwprobe || emptyHwProbeResult()
  const catalog = findCatalogDevice({
    platform: identity.platform
  , manufacturer: identity.manufacturer
  , model: identity.model
  , product: identity.product || null
  })
  const dbBrand = dbMatch && dbMatch.brand
  const brand = dbBrand || identity.manufacturer || ''
  const dbMarketName = dbMatch && (dbMatch.marketName || (dbMatch.name && dbMatch.name.id))
  const marketName = probe.marketName ||
    dbMarketName ||
    identity.marketName ||
    (catalog && catalog.name) ||
    identity.model ||
    identity.product ||
    identity.serial ||
    'Unknown'

  let longName: string
  if (!probe.marketName && dbMatch && dbMatch.name && dbMatch.name.long) {
    longName = dbMatch.name.long
  }
  else {
    longName = formatLongName(brand, marketName)
  }

  const releaseDate = (dbMatch && dbMatch.date) || probe.buildDate || null

  const dbCpu = dbMatch ? dbMatch.cpu : null
  const cpuName = (dbCpu && dbCpu.name) || formatSocName(probe) || identity.cpuPlatform || null
  const cpuCores = probe.cpuCores ?? dbCpu?.cores ?? null
  const cpuFreq = probe.cpuFreq ?? dbCpu?.freq ?? null

  const dbMemory = dbMatch ? dbMatch.memory : null
  const ram = probe.ram ?? dbMemory?.ram ?? null
  const rom = probe.rom ?? dbMemory?.rom ?? null

  const baseImage = (catalog && catalog.image) || (dbMatch && dbMatch.image) || fallbackDeviceImage
  const image = populateImageSlug(baseImage, identity)

  const merged: DeviceData = {
    name: {
      id: marketName
    , long: longName
    }
  , brand: brand
  , marketName: marketName
  , date: releaseDate
  , cpu: {
      name: cpuName
    , cores: cpuCores
    , freq: cpuFreq
    }
  , memory: {
      ram: ram
    , rom: rom
    }
  , image: image
  }

  if (dbMatch && dbMatch.flags) {
    merged.flags = dbMatch.flags
  }

  return merged
}

export default syrup.serial()
  .dependency(identitySyrup)
  .dependency(hwprobeSyrup)
  .define(function(
    _options: DevicePluginOptions
  , identity: DeviceIdentity
  , hwprobe?: HwProbeResult
  ): DeviceData {
    var log = logger.createLogger('device:plugins:data')

    function find(): DeviceData {
      log.info('Resolving device metadata')
      var dbMatch = deviceData.find({
        model: identity.model
      , name: identity.product
      , manufacturer: identity.manufacturer
      , platform: identity.platform
      })
      return mergeDeviceData(identity, hwprobe, dbMatch)
    }

    return find()
  })
