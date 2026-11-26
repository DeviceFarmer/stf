import assert from 'node:assert/strict'
import type {Response} from 'express'
import type {ApiRequest} from '../../../lib/types/units-api.js'
import wire from '../../../lib/wire/index.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

type Handler = (req: ApiRequest, res: Response) => void

class DuplicateSecondaryIndexError extends Error {}

const dbapi: Record<string, unknown> = {DuplicateSecondaryIndexError}
const adb = {
  util: {
    parsePublicKey: (_key: string): Promise<unknown> => Promise.reject(new Error('unset'))
  }
}

const restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
  default: dbapi
})
const restoreAdb = mockModule(new URL('../../../lib/util/adbutil.js', import.meta.url), {
  default: () => adb
})
const restoreLocks = mockModule(new URL('../../../lib/util/lockutil.js', import.meta.url), {
  default: {}
})

let addAdbPublicKey: Handler, getAdbPublicKeys: Handler, deleteAdbPublicKey: Handler
try {
  const controller = await importFresh(
    new URL('../../../lib/units/api/controllers/user.js', import.meta.url)
  )
  addAdbPublicKey = controller.addAdbPublicKey
  getAdbPublicKeys = controller.getAdbPublicKeys
  deleteAdbPublicKey = controller.deleteAdbPublicKey
}
finally {
  restoreLocks()
  restoreAdb()
  restoreDb()
}

const user = {email: 'alice@example.com', name: 'Alice', group: 'alice-group'}
const fingerprint = '8e:4f:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:1d'
const publicKey = 'QAAAAKeyMaterial== alice@host'

interface Reply {
  status: number
  body: {success: boolean, description: string, [key: string]: unknown}
}

function call(handler: Handler, params: Record<string, unknown>) {
  const sent: unknown[][] = []
  return new Promise<{reply: Reply, sent: unknown[][]}>(function(resolve) {
    let status = 200
    const res = {
      status(code: number) {
        status = code
        return this
      }
    , json(body: Reply['body']) {
        // Let anything sent right after the response show up before the test checks it
        setImmediate(() => resolve({reply: {status, body}, sent}))
        return this
      }
    }
    const swaggerParams: Record<string, {value: unknown}> = {}
    Object.keys(params).forEach(name => {
      swaggerParams[name] = {value: params[name]}
    })
    const req = {
      user
    , swagger: {params: swaggerParams}
    , options: {push: {send: (message: unknown[]) => sent.push(message)}}
    }
    handler(req as unknown as ApiRequest, res as unknown as Response)
  })
}

function owners(...emails: string[]) {
  return () => Promise.resolve({
    toArray: () => Promise.resolve(emails.map(email => ({email})))
  })
}

function adbKeysUpdated(message: unknown[]) {
  const envelope = wire.Envelope.decode(message[1] as Uint8Array)
  assert.equal(envelope.type, wire.MessageType.AdbKeysUpdatedMessage)
  return wire.AdbKeysUpdatedMessage.decode(envelope.message)
}

describe('API user adb public keys', function() {
  let inserted: unknown[][]

  beforeEach(function() {
    inserted = []
    adb.util.parsePublicKey = () => Promise.resolve({fingerprint, comment: 'alice@host'})
    dbapi.insertUserAdbKey = (...args: unknown[]) => {
      inserted.push(args)
      return Promise.resolve({replaced: 1})
    }
  })

  describe('POST', function() {
    it('adds an unknown key and tells the user\'s devices', async function() {
      dbapi.lookupUsersByAdbKey = owners()
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: publicKey + '\n'}})

      assert.equal(reply.status, 200)
      assert.equal(reply.body.success, true)
      assert.deepEqual(reply.body.adbPublicKey, {title: 'alice@host', fingerprint})
      assert.deepEqual(inserted, [[user.email, {
        title: 'alice@host'
      , fingerprint
      , publicKey
      }]])
      assert.equal(sent.length, 1)
      assert.equal(sent[0]![0], user.group)
      // Nothing was removed, so devices keep the keys they know
      assert.ok(!adbKeysUpdated(sent[0]!).removedFingerprint)
    })

    it('prefers the given title over the key comment', async function() {
      dbapi.lookupUsersByAdbKey = owners()
      await call(addAdbPublicKey, {adb: {publickey: publicKey, title: 'ci-runner'}})

      assert.equal((inserted[0]![1] as {title: string}).title, 'ci-runner')
    })

    it('succeeds without changes when the key is already the user\'s', async function() {
      dbapi.lookupUsersByAdbKey = owners(user.email)
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: publicKey}})

      assert.equal(reply.status, 200)
      assert.equal(reply.body.success, true)
      assert.deepEqual(inserted, [])
      assert.deepEqual(sent, [])
    })

    it('refuses a key that belongs to another user without naming them', async function() {
      dbapi.lookupUsersByAdbKey = owners('bob@example.com')
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: publicKey}})

      assert.equal(reply.status, 409)
      assert.equal(reply.body.success, false)
      assert.ok(!JSON.stringify(reply.body).includes('bob'))
      assert.deepEqual(inserted, [])
      assert.deepEqual(sent, [])
    })

    it('reports a duplicate index error from the insert as a conflict', async function() {
      dbapi.lookupUsersByAdbKey = owners()
      dbapi.insertUserAdbKey = () => Promise.reject(new DuplicateSecondaryIndexError())
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: publicKey}})

      assert.equal(reply.status, 409)
      assert.deepEqual(sent, [])
    })

    it('rejects a key that can not be parsed', async function() {
      adb.util.parsePublicKey = () => Promise.reject(new Error('Unrecognizable public key format'))
      dbapi.lookupUsersByAdbKey = () => assert.fail('must not look the key up')
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: 'nonsense'}})

      assert.equal(reply.status, 400)
      assert.match(reply.body.description, /Unrecognizable public key format/)
      assert.deepEqual(sent, [])
    })

    it('answers 500 when the database fails', async function() {
      dbapi.lookupUsersByAdbKey = () => Promise.reject(new Error('db down'))
      const {reply, sent} = await call(addAdbPublicKey, {adb: {publickey: publicKey}})

      assert.equal(reply.status, 500)
      assert.deepEqual(sent, [])
    })
  })

  describe('GET', function() {
    it('lists the user\'s own keys', async function() {
      const keys = [{title: 'ci-runner', fingerprint}]
      let asked: string | undefined
      dbapi.loadUserAdbKeys = (email: string) => {
        asked = email
        return Promise.resolve(keys)
      }
      const {reply} = await call(getAdbPublicKeys, {})

      assert.equal(asked, user.email)
      assert.equal(reply.status, 200)
      assert.equal(reply.body.success, true)
      assert.equal(typeof reply.body.description, 'string')
      assert.deepEqual(reply.body.adbPublicKeys, keys)
    })
  })

  describe('DELETE', function() {
    it('removes the user\'s key and tells the user\'s devices', async function() {
      let asked: unknown[] | undefined
      dbapi.deleteUserAdbKey = (...args: unknown[]) => {
        asked = args
        return Promise.resolve({replaced: 1})
      }
      const {reply, sent} = await call(deleteAdbPublicKey, {fingerprint})

      assert.deepEqual(asked, [user.email, fingerprint])
      assert.equal(reply.status, 200)
      assert.equal(sent.length, 1)
      assert.equal(sent[0]![0], user.group)
      assert.equal(adbKeysUpdated(sent[0]!).removedFingerprint, fingerprint)
    })

    it('answers 404 when the user has no such key', async function() {
      dbapi.deleteUserAdbKey = () => Promise.resolve({replaced: 0, unchanged: 1})
      const {reply, sent} = await call(deleteAdbPublicKey, {fingerprint})

      assert.equal(reply.status, 404)
      assert.equal(reply.body.success, false)
      assert.deepEqual(sent, [])
    })
  })
})
