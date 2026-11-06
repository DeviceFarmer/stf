'use strict'
const fs = require('node:fs')
const https = require('node:https')
const ca = fs.readFileSync('/var/run/stf-migration/ca.crt')
const path = '/apis/batch/v1/namespaces/' + encodeURIComponent(process.env.POD_NAMESPACE) +
  '/jobs/' + encodeURIComponent(process.env.MIGRATION_JOB)
const deadline = Date.now() + Number(process.env.WAIT_SECONDS || 600) * 1000
function get() {
  return new Promise((resolve, reject) => {
    const req = https.get({hostname: 'kubernetes.default.svc', path, ca,
      headers: {Authorization: 'Bearer ' + fs.readFileSync('/var/run/stf-migration/token', 'utf8').trim()}, timeout: 5000}, res => {
      const chunks = []
      let size = 0
      res.on('data', b => { size += b.length; if (size > 1024 * 1024) req.destroy(new Error('Job response too large')); else chunks.push(b) })
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null)
        if (res.statusCode !== 200) return reject(new Error('Migration Job read failed: HTTP ' + res.statusCode))
        try { resolve(JSON.parse(Buffer.concat(chunks))) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('Kubernetes API timeout')))
    req.on('error', reject)
  })
}
;(async () => {
  while (Date.now() < deadline) {
    const job = await get()
    const conditions = job?.status?.conditions || []
    if (conditions.some(c => c.type === 'Complete' && c.status === 'True')) return
    if (conditions.some(c => c.type === 'Failed' && c.status === 'True')) throw new Error('Database migration failed; inspect the migration Job')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Timed out waiting for database migration')
})().catch(e => { console.error(e.message); process.exitCode = 1 })
