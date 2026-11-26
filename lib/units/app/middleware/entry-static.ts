import crypto from 'crypto'
import fs from 'fs'
import type {ServerResponse} from 'http'

import serveStatic from 'serve-static'

// Serves the prebuilt entry bundle, the one file name that stays the same across builds.
// `npm pack` gives every file the same 1985 mtime, so serve-static's weak ETag (size and mtime)
// matches across builds whenever the entry keeps its size, and browsers reuse the old entry, which
// then requests chunks the new build no longer has. Validate it by its content instead.
export default function entryStatic(root: string) {
  const etags = new Map<string, string>()
  return serveStatic(root, {
    etag: false
  , lastModified: false
  , setHeaders(res: ServerResponse, file: string) {
      let etag = etags.get(file)
      if (!etag) {
        // The prebuilt files never change while the unit runs, so hash each one once
        // eslint-disable-next-line no-sync
        const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64url')
        etag = `"${digest}"`
        etags.set(file, etag)
      }
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('ETag', etag)
    }
  })
}
