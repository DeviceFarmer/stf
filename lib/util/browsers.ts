import fs from 'fs'

import pathutil from './pathutil.js'

export interface BrowserPlatform {
  package: string
  system?: boolean
}

export interface BrowserData {
  developer: string
  name: string
  platforms: {
    android?: BrowserPlatform
  }
  supersedes?: string
}

// Keyed by browser id, which is also the icon name in res/common/browsers/icon.
// Loaded once when the module is first imported.
// eslint-disable-next-line no-sync
const browsers: Record<string, BrowserData> = JSON.parse(fs.readFileSync(
  pathutil.resource('common/browsers/inventory.json')
, 'utf8'
))

export default browsers
