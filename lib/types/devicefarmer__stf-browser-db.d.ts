declare module '@devicefarmer/stf-browser-db' {
  interface BrowserPlatform {
    package: string
    system: boolean
  }

  interface BrowserData {
    developer: string
    name: string
    platforms: {
      android?: BrowserPlatform
    }
    supersedes?: string
  }

  const browsers: Record<string, BrowserData>

  export = browsers
}
