import assert from 'node:assert/strict'
import sinon from 'sinon'
import {TouchGesture} from '../../lib/wire/touch-gesture.js'
import {TouchProtocol} from '../../lib/units/device/plugins/touch/protocol.js'

const source = '11111111-1111-4111-8111-111111111111'
const owner = 'reservation-one'
const id = (order: number, origin = source) => origin + ':' + order

function fixture(options: ConstructorParameters<typeof TouchGesture>[1] = {}) {
  const commands: string[] = []
  const errors: Error[] = []
  const protocol = new TouchProtocol(command => commands.push(command), () => 10)
  const gesture = new TouchGesture(() => protocol.reset(), {
    ...options, report: error => errors.push(error)
  })
  gesture.setOwner(owner)
  const down = (seq: number, key: string, reservation = owner) => gesture.push(seq,
    () => protocol.down(0, {x: 500, y: 750, pressure: 500}), key, reservation)
  const commit = (seq: number, key: string) =>
    gesture.push(seq, () => protocol.commit(), key, owner)
  const up = (seq: number, key: string) => gesture.push(seq, () => protocol.up(0), key, owner)
  return {gesture, protocol, commands, errors, down, commit, up}
}

describe('provider fenced gesture sequencing', function() {
  it('resets an incomplete legacy gesture and discards its sequence backlog', function() {
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
    gesture.clear('new')
  })

  it('ignores delayed legacy cleanup after a newer gesture starts or stops', function() {
    let resets = 0
    const gesture = new TouchGesture(() => resets++)
    const delivered: string[] = []
    gesture.start(0, 'old')
    gesture.clear()
    gesture.start(0, 'new')
    gesture.push(1, () => delivered.push('new-down'))
    gesture.clear('old')
    gesture.push(2, () => delivered.push('new-up'))
    assert.equal(resets, 1)
    assert.deepEqual(delivered, ['new-down', 'new-up'])
    gesture.stop(3)
    assert.equal(resets, 2, 'Stop releases any contact left by an incomplete gesture')
    gesture.clear('new')
    assert.equal(resets, 2, 'Cleanup after Stop cannot reset another gesture')
  })

  it('preserves legacy packet ordering and resets at an ownership boundary', function() {
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
    gesture.clear('new')
  })

  it('buffers Down before Start and restores the original tap', function() {
    const f = fixture(); const key = id(1)
    f.down(1, key)
    f.commit(2, key)
    assert.deepEqual(f.commands, [])
    f.gesture.start(0, key, owner)
    f.up(3, key)
    f.commit(4, key)
    f.gesture.stop(5, key, owner)
    assert.deepEqual(f.commands, ['d 0 500 750 500\nc\n', 'u 0\nc\n'])
  })

  it('preserves a reordered swipe after a completed tap', function() {
    const f = fixture()
    f.gesture.start(0, id(1), owner)
    f.down(1, id(1))
    f.commit(2, id(1))
    f.up(3, id(1))
    f.commit(4, id(1))
    f.gesture.stop(5, id(1), owner)
    f.down(7, id(2))
    f.gesture.start(6, id(2), owner)
    f.commit(8, id(2))
    for (let step = 0; step < 10; step++) {
      f.gesture.push(9 + step * 2, () => f.protocol.move(0,
        {x: 500, y: 700 - step * 50, pressure: 500}), id(2), owner)
      f.commit(10 + step * 2, id(2))
    }
    f.up(29, id(2))
    f.commit(30, id(2))
    f.gesture.stop(31, id(2), owner)
    assert.equal(f.commands.length, 14)
    assert.equal(f.commands.filter(command => command.startsWith('m ')).length, 10)
    assert.deepEqual(f.errors, [])
  })

  it('never skips a missing Down behind buffered future packets', function() {
    const f = fixture(); const key = id(1)
    for (let seq = 8; seq <= 16; seq++) {
      f.gesture.push(seq, () => f.commands.push(String(seq)), key, owner)
    }
    f.gesture.start(6, key, owner)
    assert.deepEqual(f.commands, [])
    f.gesture.push(7, () => f.commands.push('7'), key, owner)
    assert.deepEqual(f.commands, Array.from({length: 10}, (_, index) => String(7 + index)))
    f.gesture.clear(key, owner)
  })

  it('orders Stop received before Start and ignores the tail after Stop', function() {
    const f = fixture(); const key = id(2)
    f.gesture.start(0, id(1), owner)
    f.gesture.stop(3, key, owner)
    f.gesture.push(4, () => f.commands.push('after-stop'), key, owner)
    f.gesture.start(0, key, owner)
    f.gesture.push(2, () => f.commands.push('second'), key, owner)
    f.gesture.push(1, () => f.commands.push('first'), key, owner)
    assert.deepEqual(f.commands, ['first', 'second'])
  })

  it('cancels an unknown pending gesture without resetting another active gesture', function() {
    const f = fixture()
    f.gesture.start(0, id(1), owner)
    f.down(1, id(1))
    f.commit(2, id(1))
    f.down(1, id(2))
    f.gesture.clear(id(2), owner)
    f.gesture.start(0, id(2), owner)
    f.up(3, id(1))
    f.commit(4, id(1))
    assert.deepEqual(f.commands, ['d 0 500 750 500\nc\n', 'u 0\nc\n'])
    f.gesture.stop(5, id(1), owner)
  })

  it('rejects old Start and Reset after a newer gesture or owner has been accepted', function() {
    const f = fixture()
    f.gesture.start(0, id(2), owner)
    f.gesture.start(0, id(1), owner)
    f.gesture.clear(id(1), owner)
    f.gesture.push(1, () => f.commands.push('current'), id(2), owner)
    assert.deepEqual(f.commands, ['current'])
    f.gesture.setOwner('new-owner')
    f.down(1, id(3), owner)
    f.gesture.start(0, id(3), owner)
    f.gesture.start(0, id(4), 'new-owner')
    f.gesture.clear(id(4), owner)
    f.gesture.push(1, () => f.commands.push('new-owner'), id(4), 'new-owner')
    assert.deepEqual(f.commands, ['current', 'new-owner'])
    f.gesture.clear(id(4), 'new-owner')
  })

  it('drops old-owner packets and rejects incomplete identities', function() {
    const f = fixture()
    f.down(1, id(1))
    f.gesture.setOwner('new-owner')
    for (const key of [undefined, '', 'not-a-socket-id', source + ':9007199254740992']) {
      f.gesture.start(0, key, 'new-owner')
      f.gesture.push(1, () => f.commands.push('unsafe'), key, 'new-owner')
    }
    f.gesture.start(0, id(1), owner)
    f.gesture.start(0, id(2), 'new-owner')
    f.gesture.push(1, () => f.commands.push('safe'), id(2), 'new-owner')
    assert.deepEqual(f.commands, ['safe'])
    f.gesture.clear(id(2), 'new-owner')
  })

  it('retains source ordering after tombstone eviction and source overflow',
    function() {
    const f = fixture({maxSources: 2, maxRetired: 2})
    for (let order = 1; order <= 5; order++) {
      f.gesture.start(0, id(order), owner)
      f.gesture.stop(1, id(order), owner)
    }
    f.gesture.start(0, id(1), owner)
    f.gesture.push(1, () => f.commands.push('old'), id(1), owner)
    const other = '22222222-2222-4222-8222-222222222222'
    const extra = '33333333-3333-4333-8333-333333333333'
    f.gesture.start(0, id(1, other), owner)
    f.gesture.start(0, id(1, extra), owner)
    f.gesture.push(1, () => f.commands.push('extra'), id(1, extra), owner)
    f.gesture.push(1, () => f.commands.push('retained'), id(1, other), owner)
    assert.deepEqual(f.commands, ['retained'])
    assert.ok(f.errors.some(error => /source limit/.test(error.message)))
    f.gesture.setOwner('new-owner')
    f.gesture.start(0, id(1, extra), 'new-owner')
    f.gesture.push(1, () => f.commands.push('reset'), id(1, extra), 'new-owner')
    assert.deepEqual(f.commands, ['retained', 'reset'])
    f.gesture.clear(id(1, extra), 'new-owner')
  })

  it('bounds pre-Start packets and gestures without growing duplicate sequence slots', function() {
    const f = fixture({maxPendingGestures: 2, maxPendingPackets: 3})
    for (let count = 0; count < 100; count++) {
      f.down(1, id(1))
    }
    f.commit(2, id(1))
    f.down(1, id(2))
    f.down(1, id(3))
    f.commit(2, id(2))
    assert.ok(f.errors.length >= 1)
    assert.ok((f.gesture as any).pendingPackets <= 3)
    assert.ok((f.gesture as any).pending.size <= 2)
    f.gesture.setOwner(null)
    assert.equal((f.gesture as any).pendingPackets, 0)
  })

  it('deduplicates active waiting slots and wraps the sequence counter', function() {
    const f = fixture(); const key = id(1)
    f.gesture.start(98, key, owner)
    for (let count = 0; count < 100; count++) {
      f.gesture.push(0, () => f.commands.push('zero'), key, owner)
    }
    f.gesture.push(99, () => f.commands.push('last'), key, owner)
    f.gesture.push(1, () => f.commands.push('next'), key, owner)
    assert.deepEqual(f.commands, ['last', 'zero', 'next'])
    f.gesture.stop(2, key, owner)
  })

  for (const beforeStart of [false, true]) {
    it(`orders wraparound 0 and 1 before Down 99 (early prefix: ${beforeStart})`, function() {
      const f = fixture()
      const key = id(1)
      if (!beforeStart) {
        f.gesture.start(98, key, owner)
      }
      f.commit(0, key)
      f.gesture.push(1, () => f.protocol.move(0,
        {x: 500, y: 500, pressure: 500}), key, owner)
      f.down(99, key)
      if (beforeStart) {
        f.gesture.start(98, key, owner)
      }
      f.commit(2, key)
      f.up(3, key)
      f.commit(4, key)
      f.gesture.stop(5, key, owner)
      assert.deepEqual(f.commands, [
        'd 0 500 750 500\nc\n', 'm 0 500 500 500\nc\n', 'u 0\nc\n'
      ])
    })
  }

  it('drains a full future window when its missing head arrives', function() {
    const f = fixture()
    const key = id(1)
    f.gesture.start(0, key, owner)
    for (let seq = 2; seq <= 50; seq++) {
      f.gesture.push(seq, () => f.commands.push(String(seq)), key, owner)
    }
    assert.deepEqual(f.commands, [])
    f.gesture.push(1, () => f.commands.push('1'), key, owner)
    assert.deepEqual(f.commands, Array.from({length: 50}, (_, index) => String(index + 1)))
    assert.deepEqual(f.errors, [])
    f.gesture.clear(key, owner)
  })

  it('keeps a long gesture intact across multiple sequence wraps', function() {
    const f = fixture()
    const key = id(1)
    let seq = 98
    const advance = () => {
      seq = (seq + 1) % 100
      return seq
    }
    f.gesture.start(seq, key, owner)
    f.down(advance(), key)
    f.commit(advance(), key)
    for (let step = 0; step < 150; step++) {
      f.gesture.push(advance(), () => f.protocol.move(0,
        {x: 500, y: 500, pressure: 500}), key, owner)
      f.commit(advance(), key)
    }
    f.up(advance(), key)
    f.commit(advance(), key)
    f.gesture.stop(advance(), key, owner)
    assert.equal(f.commands.length, 152)
    assert.deepEqual(f.errors, [])
  })

  it('ignores consumed duplicate slots without timing out a held contact', function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture({gapTimeoutMs: 50})
      const key = id(1)
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      f.commit(2, key)
      clock.tick(1000)
      assert.equal(f.commands.length, 1)
      assert.deepEqual(f.errors, [])
      for (const invalid of [-1, 100, NaN, 0.5]) {
        f.gesture.push(invalid, () => f.commands.push('invalid'), key, owner)
      }
      f.up(3, key)
      f.commit(4, key)
      f.gesture.stop(5, key, owner)
      assert.equal(f.commands.length, 2)
    }
    finally {
      clock.restore()
    }
  })

  it('cancels a held contact when its Stop is outside the reorder window', function() {
    const f = fixture()
    const key = id(1)
    f.gesture.start(0, key, owner)
    f.down(1, key)
    f.commit(2, key)
    f.gesture.stop(70, key, owner)
    assert.deepEqual(f.commands, ['d 0 500 750 500\nc\n', 'u 0\nc\n'])
    assert.equal((f.gesture as any).current, null)
    f.up(3, key)
    f.commit(4, key)
    assert.equal(f.commands.length, 2)
    assert.ok(f.errors.some(error => /termination/.test(error.message)))
  })

  it('expires a persistent sequence gap without timing out a long press', function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture({gapTimeoutMs: 50}); const key = id(1)
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      clock.tick(1000)
      assert.equal(f.commands.length, 1, 'An idle held contact has no sequence gap')
      f.gesture.push(4, () => f.commands.push('future'), key, owner)
      clock.tick(51)
      assert.equal(f.commands.at(-1), 'u 0\nc\n')
      f.up(3, key)
      assert.equal(f.commands.includes('future'), false)
      assert.ok(f.errors.some(error => /timed out/.test(error.message)))
    }
    finally {
      clock.restore()
    }
  })

  it('expires orphan prefixes without cancelling another active gesture', function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture({maxPendingGestures: 2, gapTimeoutMs: 50})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      f.down(1, id(2))
      f.down(1, id(3))
      clock.tick(51)
      assert.equal((f.gesture as any).pending.size, 0)
      assert.equal(f.commands.length, 1)
      f.gesture.start(0, id(2), owner)
      f.up(3, id(1))
      f.commit(4, id(1))
      f.gesture.stop(5, id(1), owner)
      f.gesture.start(0, id(4), owner)
      f.down(1, id(4))
      f.commit(2, id(4))
      assert.equal(f.commands.length, 3)
      f.gesture.clear(id(4), owner)
    }
    finally {
      clock.restore()
    }
  })

  it('permits legacy sequencing only without a protected owner', function() {
    const calls: number[] = []
    const gesture = new TouchGesture(() => {})
    gesture.push(1, () => calls.push(1))
    gesture.start(0)
    gesture.stop(2)
    assert.deepEqual(calls, [1])
    gesture.setOwner(owner)
    gesture.start(0)
    gesture.push(1, () => calls.push(2))
    assert.deepEqual(calls, [1])
  })
})
