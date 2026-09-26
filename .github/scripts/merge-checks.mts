//
// Fold the checks a Playwright run reported into the leg's checks.json.
//
// usage: node merge-checks.mts <checks.json> <playwright-checks.json>
//
// The leg script seeds every layer before it starts, so most keys arrive here
// already set; checks.mts owns which value wins.
//

import fs from 'fs'
import * as layers from './checks.mts'

interface PlaywrightSummary {
  checks?: Record<string, string>
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  }
  catch (e) {
    return fallback
  }
}

function main() {
  var checksPath = process.argv[2] || 'checks.json'
  var checks = readJson<layers.Checks>(checksPath, {})
  var summary = readJson<PlaywrightSummary>(process.argv[3] || 'playwright-checks.json', {})

  Object.keys(summary.checks || {}).forEach(function(key) {
    checks[key] = layers.merge(checks[key], summary.checks![key]!)
  })

  fs.writeFileSync(checksPath, JSON.stringify(checks, null, 2))
  console.log(JSON.stringify(checks, null, 2))
}

main()
