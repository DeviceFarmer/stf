import assert from 'node:assert/strict'
import {TouchGesture} from '../../lib/units/device/plugins/touch/gesture.js'

describe('provider scoped gesture cleanup', function() {
  it('resets an incomplete gesture and discards its sequence backlog', function() {
    let resets = 0
    const gesture = new TouchGesture(() => resets++)
    const delivered: string[] = []
    gesture.start(0, 'old')
    gesture.push(1, () => delivered.push('down'))
    gesture.push(3, () => delivered.push('old-up'))
    gesture.clear('old')
    assert.equal(resets, 1)
    gesture.start(0, 'new')
    gesture.push(1, () => delivered.push('new-down'))
    gesture.push(2, () => delivered.push('new-up'))
    assert.deepEqual(delivered, ['down', 'new-down', 'new-up'])
  })

  it('ignores delayed cleanup from an old owner after a newer gesture starts', function() {
    let resets = 0
    const gesture = new TouchGesture(() => resets++)
    const delivered: string[] = []
    gesture.start(0, 'old')
    gesture.clear()
    gesture.start(0, 'new')
    gesture.push(1, () => delivered.push('new-down'))
    gesture.clear('old')
    gesture.push(2, () => delivered.push('new-up'))
    gesture.stop(3)
    gesture.clear('new')
    assert.equal(resets, 1)
    assert.deepEqual(delivered, ['new-down', 'new-up'])
  })

  it('preserves legacy sequenced packets and resets at an ownership boundary', function() {
    let resets = 0
    const gesture = new TouchGesture(() => resets++)
    const delivered: string[] = []
    gesture.start(0)
    gesture.push(2, () => delivered.push('second'))
    gesture.push(1, () => delivered.push('first'))
    gesture.clear()
    gesture.push(3, () => delivered.push('stale'))
    gesture.start(0, 'new')
    gesture.push(1, () => delivered.push('new-first'))
    gesture.push(2, () => delivered.push('new-second'))
    assert.equal(resets, 1)
    assert.deepEqual(delivered, ['first', 'second', 'new-first', 'new-second'])
  })
})
