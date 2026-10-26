import serveStatic from 'serve-static'
import {Router as createRouter} from 'express'
import type {Request, Response, NextFunction} from 'express'
import deviceData from '@devicefarmer/stf-device-db'

import pathutil from '../../../util/pathutil.js'
import {fallbackDeviceImage} from '../../../util/device-image-paths.js'

const CACHE_CONTROL_HEADER = 'public, max-age=2592000'
// Generated SVGs embed request-derived text; forbid scripts and external loads if opened directly
const CONTENT_SECURITY_POLICY = 'default-src \'none\'; style-src \'unsafe-inline\''
const DYNAMIC_QUERY_KEYS = ['w', 'h', 'xd', 'yd', 'dpi', 'sdk', 'b', 'm']

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed !== '' ? trimmed : null
}

function hasDynamicQuery(query: Record<string, unknown>): boolean {
  return DYNAMIC_QUERY_KEYS.some(function(key) {
    return parseNonEmptyString(query[key]) !== null
  })
}

export default function() {
  const router = createRouter()
  const staticDevices = serveStatic(pathutil.resource('devices'), {maxAge: '30d'})

  router.use(function(req: Request, res: Response, next: NextFunction) {
    const query = req.query as Record<string, unknown>
    if (req.path.endsWith('/' + fallbackDeviceImage) && hasDynamicQuery(query)) {
      next()
      return
    }
    staticDevices(req, res, next)
  })

  router.get('/:type/:size/:image', function(req: Request, res: Response, next: NextFunction) {
    const type = req.params.type
    const size = req.params.size
    const image = req.params.image || ''

    if ((type !== 'icon' && type !== 'photo') ||
        (size !== 'x24' && size !== 'x120' && size !== 'x800')) {
      next()
      return
    }

    const query = req.query as Record<string, unknown>
    const stem = image.replace(/\.(?:svg|jpe?g|png|webp)$/i, '').trim()
    const isIos = /^ios$/i.test(stem)
    const isGeneric = stem === 'generic-phone-v1'

    // Catalogue WebP files are served statically, so one reaching this route does not exist
    if (!stem || /\.webp$/i.test(image)) {
      next()
      return
    }

    // Without live metrics, only render images that the device database can actually describe
    if (!isIos && !isGeneric && !hasDynamicQuery(query) &&
        !deviceData.find({model: stem, name: stem})) {
      next()
      return
    }

    const svgParams: deviceData.GenerateDeviceSvgParams = {size: size, image: image}
    if (isIos) {
      svgParams.platform = 'iOS'
    }

    const brand = parseNonEmptyString(query.b)
    const marketName = parseNonEmptyString(query.m)
    const width = parsePositiveNumber(query.w)
    const height = parsePositiveNumber(query.h)
    const xdpi = parsePositiveNumber(query.xd)
    const ydpi = parsePositiveNumber(query.yd)
    const dpi = parsePositiveNumber(query.dpi)
    const sdk = parsePositiveNumber(query.sdk)
    if (brand) {
      svgParams.brand = brand
    }
    if (marketName) {
      svgParams.marketName = marketName
    }
    if (width) {
      svgParams.width = width
    }
    if (height) {
      svgParams.height = height
    }
    if (xdpi) {
      svgParams.xdpi = xdpi
    }
    if (ydpi) {
      svgParams.ydpi = ydpi
    }
    if (dpi) {
      svgParams.dpi = dpi
    }
    if (sdk && !isIos) {
      svgParams.sdk = sdk
    }

    const svg = deviceData.generateDeviceSvg(svgParams)

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    res.setHeader('Cache-Control', CACHE_CONTROL_HEADER)
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.status(200).send(svg)
  })

  return router
}
