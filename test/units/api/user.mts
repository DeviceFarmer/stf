import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import type {Response} from 'express'
import ZSchema from 'z-schema'
import type {AddUserDeviceBody, ApiRequest} from '../../../lib/types/units-api.js'
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
let addUserDevice: (req: ApiRequest<AddUserDeviceBody>, res: Response) => void
try {
  const controller = await importFresh(
    new URL('../../../lib/units/api/controllers/user.js', import.meta.url)
  )
  getUser = controller.getUser
  addUserDevice = controller.addUserDevice
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

  it('requires an authorized managed lease for screen lifecycle', function() {
    for (const [leaseId, expectedStatus] of [[undefined, 400], ['lease-id', 403]] as const) {
      const req = {body: {serial: 'phone', leaseId, screenLifecycle: true}
        , options: {automationLeaseAccounts: ['runner@example.test']}
        , user: {email: 'viewer@example.test'}}
      const res = {statusCode: 200, status(code: number) {
        this.statusCode = code
        return this
      }, json() {}}
      addUserDevice(req as unknown as ApiRequest<AddUserDeviceBody>, res as unknown as Response)
      assert.equal(res.statusCode, expectedStatus)
    }
  })

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

    const validator = ZSchema.create({safe: true, breakOnFirstError: false})
    const {valid, err} = validator.validate(responseBody, userResponseSchema)
    assert.equal(valid, true, `Schema mismatch: ${JSON.stringify(err?.details)}`)
  })

  it('fails swagger validation without description (regression guard for #302)', function() {
    const payloadWithoutDescription = {
      success: true
    , user: {email: 'test@example.com'}
    }
    const validator = ZSchema.create({safe: true, breakOnFirstError: false})
    const {valid, err} = validator.validate(payloadWithoutDescription, userResponseSchema)
    assert.equal(valid, false, 'Payload without description must fail validation')
    assert.ok(
      err?.details?.some(detail => detail.code === 'OBJECT_MISSING_REQUIRED_PROPERTY' &&
        detail.params.includes('description'))
    , 'Validation error should indicate missing description'
    )
  })
})
