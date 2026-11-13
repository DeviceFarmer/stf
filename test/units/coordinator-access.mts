import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {CoordinatorAccess} from '../../lib/units/coordinator/access.js'

const operator = 'operator-secret-'.repeat(3)
const token = 'project-secret-'.repeat(3)
const policy = () => ({id: 'gitlab-145', maxParallel: 2
  , tokenSha256: createHash('sha256').update(token).digest('hex')})

describe('coordinator project credentials', () => {
  it('separates operator recovery from project access and does not expose token values', () => {
    const access = new CoordinatorAccess(operator, [policy()])
    assert.deepEqual(access.authenticate('Bearer ' + token),
      {projectId: 'gitlab-145', admin: false})
    assert.deepEqual(access.authenticate('Basic ' + Buffer.from('coordinator:' + operator)
      .toString('base64')), {projectId: 'legacy', admin: true})
    assert.equal(access.authenticate('Bearer invalid'), null)
    assert.equal(access.authenticate(undefined), null)
    const identity = access.authenticate('Bearer ' + token)!
    access.assertProject(identity, 'gitlab-145', 'lease')
    assert.throws(() => access.assertProject(identity, 'another', 'lease'), /Resource not found/)
    assert.throws(() => access.assertAdmin(identity), /operator required/)
    assert.equal(access.limits().get('gitlab-145'), 2)
    assert.doesNotMatch(JSON.stringify(access), new RegExp(token + '|' + operator))
  })

  it('rejects duplicate credentials, reserved IDs and invalid quota policies', () => {
    for (const policies of [[policy(), policy()], [{...policy(), id: 'legacy'}]
      , [{...policy(), maxParallel: 0}], [{...policy(), tokenSha256: 'invalid'}]
      , [{...policy(), id: undefined}], [{...policy()
        , tokenSha256: createHash('sha256').update(operator).digest('hex')}]
    ]) {
 assert.throws(() => new CoordinatorAccess(operator, policies as any))
}
  })
})
