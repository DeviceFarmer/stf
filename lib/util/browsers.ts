import inventory from '../../res/common/browsers/inventory.json' with {type: 'json'}

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
const browsers: Record<string, BrowserData> = inventory

export default browsers
