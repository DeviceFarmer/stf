import fs from 'fs'
import path from 'path'
import {styleText} from 'util'

import semver from 'semver'

export const BYPASS = 'ALLOW_OUTDATED_DEPENDENCIES'

interface PackageJson {
  version?: string
  engines?: Record<string, string>
  dependencies?: Record<string, string>
}

function readJson(file: string): PackageJson {
  // runs once at startup, before anything else is loaded
  // eslint-disable-next-line no-sync
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// Ranges npm installs from somewhere other than the registry (URLs, git,
// GitHub shorthands, local paths, aliases) have no version to compare.
function isRegistryRange(wanted: string) {
  return semver.validRange(wanted) !== null
}

// Returns one message per problem, empty when everything is fine.
export function findProblems(root: string, nodeVersion = process.version): string[] {
  var pkg = readJson(path.join(root, 'package.json'))
  var problems: string[] = []

  var wantedNode = pkg.engines?.node
  if (wantedNode && !semver.satisfies(nodeVersion, wantedNode)) {
    problems.push(`node is ${nodeVersion} but needs to be ${wantedNode}`)
  }

  // An npm or Docker install has its dependencies resolved by npm. Only a
  // source checkout can be left behind after a `git pull`.
  // eslint-disable-next-line no-sync
  if (!fs.existsSync(path.join(root, '.git'))) {
    return problems
  }

  Object.entries(pkg.dependencies || {}).forEach(function([name, wanted]) {
    if (!isRegistryRange(wanted)) {
      return
    }
    var installed: PackageJson
    try {
      installed = readJson(path.join(root, 'node_modules', name, 'package.json'))
    }
    catch {
      problems.push(`${name} is not installed`)
      return
    }
    if (!installed.version || !semver.satisfies(installed.version, wanted)) {
      problems.push(`${name} is ${installed.version} but needs to be ${wanted}`)
    }
  })

  return problems
}

// Exits the process when the installed Node or dependencies don't match
// package.json.
export function verify(root: string) {
  if (process.env[BYPASS] === '1') {
    return
  }

  var problems = findProblems(root)
  if (!problems.length) {
    return
  }

  var error = styleText('red', 'ERROR:')
  var hint = styleText('yellow', 'HINT:')
  problems.forEach(function(problem) {
    // eslint-disable-next-line no-console
    console.error(error, problem)
  })
  // eslint-disable-next-line no-console
  console.error(hint, 'Run `npm install`, or use a supported Node version.')
  // eslint-disable-next-line no-console
  console.error(hint, `Export ${BYPASS}=1 to skip this check.`)
  process.exit(1)
}
