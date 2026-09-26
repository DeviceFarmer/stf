import util from 'util'

import Promise from 'bluebird'
import semver from 'semver'
import {minimatch} from 'minimatch'

import wire from '../wire/index.js'
import type {DeviceRequirement} from '../types/wire.js'

class RequirementMismatchError extends Error {
  constructor(name: string) {
    super()
    this.name = 'RequirementMismatchError'
    this.message = util.format('Requirement mismatch for "%s"', name)
    Error.captureStackTrace(this, RequirementMismatchError)
  }
}

class AlreadyGroupedError extends Error {
  constructor() {
    super()
    this.name = 'AlreadyGroupedError'
    this.message = 'Already a member of another group'
    Error.captureStackTrace(this, AlreadyGroupedError)
  }
}

class NoGroupError extends Error {
  constructor() {
    super()
    this.name = 'NoGroupError'
    this.message = 'Not a member of any group'
    Error.captureStackTrace(this, NoGroupError)
  }
}

var match = Promise.method(function(
  capabilities: Record<string, string | undefined>
, requirements: DeviceRequirement[]
) {
  return requirements.every(function(req) {
    var capability = capabilities[req.name]

    if (!capability) {
      throw new RequirementMismatchError(req.name)
    }

    switch (req.type) {
      case wire.RequirementType.SEMVER:
        if (!semver.satisfies(capability, req.value)) {
          throw new RequirementMismatchError(req.name)
        }
        break
      case wire.RequirementType.GLOB:
        if (!minimatch(capability, req.value)) {
          throw new RequirementMismatchError(req.name)
        }
        break
      case wire.RequirementType.EXACT:
        if (capability !== req.value) {
          throw new RequirementMismatchError(req.name)
        }
        break
      default:
        throw new RequirementMismatchError(req.name)
    }

    return true
  })
})

export default {RequirementMismatchError, AlreadyGroupedError, NoGroupError, match}
