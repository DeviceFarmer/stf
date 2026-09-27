declare module '@devicefarmer/adbkit-apkreader' {
  import Bluebird from 'bluebird'

  class ApkReader {
    static open(apk: string | Buffer): Bluebird<ApkReader>
    readManifest(options?: object): Bluebird<Record<string, unknown>>
  }

  export = ApkReader
}
