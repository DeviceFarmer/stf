import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import type {Response} from 'express'
import ZSchema from 'z-schema'
import type {ApiRequest} from '../../../lib/types/units-api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as {
  load: (content: string) => unknown
}

const restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
  default: {}
})
const restoreAdb = mockModule(new URL('../../../lib/util/adbutil.js', import.meta.url), {
  default: () => ({})
})
const restoreLocks = mockModule(new URL('../../../lib/util/lockutil.js', import.meta.url), {
  default: {}
})

let getUser: (req: ApiRequest, res: Response) => void
try {
  const controller = await importFresh(
    new URL('../../../lib/units/api/controllers/user.js', import.meta.url)
  )
  getUser = controller.getUser
}
finally {
  restoreLocks()
  restoreAdb()
  restoreDb()
}

interface SwaggerSpec {
  definitions: {
    UserResponse: Record<string, unknown>
  }
}

interface UserResponseBody {
  success: boolean
  description: string
  user: unknown
}

describe('API user controller', function() {
  const swaggerYaml = fs.readFileSync(
    new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
  , 'utf8'
  )
  const spec = yaml.load(swaggerYaml) as SwaggerSpec
  const userResponseSchema = spec.definitions.UserResponse

  it('responds with description matching UserResponse schema (#302)', function() {
    const mockUser = {
      email: 'test@example.com'
    , name: 'Test User'
    , privilege: 'user'
    , groups: {
        subscribed: ['default']
      }
    }
    const req = {
      user: mockUser
    }
    let responseBody: UserResponseBody | undefined

    const res = {
      statusCode: 200
    , status(code: number) {
        this.statusCode = code
        return this
      }
    , json(body: unknown) {
        responseBody = body as UserResponseBody
        return this
      }
    }

    getUser(req as unknown as ApiRequest, res as unknown as Response)

    assert.ok(responseBody, 'Response json should be called')
    assert.equal(responseBody.success, true)
    assert.equal(responseBody.description, 'User Profile')
    assert.equal(responseBody.user, mockUser)

    const validator = new ZSchema({breakOnFirstError: false})
    const isValid = validator.validate(responseBody, userResponseSchema)
    const errorMsg = JSON.stringify(validator.getLastErrors())
    assert.equal(isValid, true, `Schema mismatch: ${errorMsg}`)
  })

  it('fails swagger validation without description (regression guard for #302)', function() {
    const payloadWithoutDescription = {
      success: true
    , user: {email: 'test@example.com'}
    }
    const validator = new ZSchema({breakOnFirstError: false})
    const isValid = validator.validate(payloadWithoutDescription, userResponseSchema)
    assert.equal(isValid, false, 'Payload without description must fail validation')
    const errors = validator.getLastErrors()
    assert.ok(
      errors.some(err => err.params.includes('description'))
    , 'Validation error should indicate missing description'
    )
  })
})
