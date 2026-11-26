import crypto from 'crypto'
import fs from 'fs'
import type {ServerResponse} from 'http'

import serveStatic from 'serve-static'

// Serves the prebuilt entry bundle, the one file name that stays the same across builds.
// `npm pack` gives every file the same 1985 mtime, so serve-static's weak ETag (size and mtime)
// matches across builds whenever the entry keeps its size, and browsers reuse the old entry, which
// then requests chunks the new build no longer has. Validate it by its content instead.
export default function entryStatic(root: string) {
  const etags = new Map<string, {version: string, etag: string}>()
  return serveStatic(root, {
    etag: false
  , lastModified: false
  , setHeaders(res: ServerResponse, file: string, stat: fs.Stats) {
      res.setHeader('Cache-Control', 'no-cache')
      // Hash each version once; size and mtime change when the bundle is rebuilt in place
      const version = `${stat.size}:${stat.mtimeMs}`
      let cached = etags.get(file)
      if (cached?.version !== version) {
        try {
          // eslint-disable-next-line no-sync
          const body = fs.readFileSync(file)
          const digest = crypto.createHash('sha256').update(body).digest('base64url')
          cached = {version, etag: `"${digest}"`}
          etags.set(file, cached)
        }
        catch {
          // Unreadable now; send's own read fails the request without crashing the unit
          etags.delete(file)
          return
        }
      }
      res.setHeader('ETag', cached.etag)
    }
  })
}
