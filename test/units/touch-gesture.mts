import assert from 'node:assert/strict'
import sinon from 'sinon'
import {TouchGesture} from '../../lib/wire/touch-gesture.js'
import {TouchProtocol} from '../../lib/units/device/plugins/touch/protocol.js'

const source = '11111111-1111-4111-8111-111111111111'
const owner = 'reservation-one'
let stampedAt = Date.now()
const id = (order: number, origin = source, issuedAt = stampedAt) =>
  origin + ':' + order + ':' + issuedAt

function fixture(options: ConstructorParameters<typeof TouchGesture>[1] = {}) {
  stampedAt = Date.now()
  const commands: string[] = []
  const errors: Error[] = []
  const protocol = new TouchProtocol(command => commands.push(command), () => 10)
  const gesture = new TouchGesture(() => protocol.reset(), {
    onFinish: contacts => {
      for (const contact of contacts) {
        protocol.up(contact)
      }
      protocol.commit()
    }, ...options, report: error => errors.push(error)
  })
  gesture.setOwner(owner)
  const down = (seq: number, key: string, reservation = owner, contact = 0) => gesture.push(seq,
    () => protocol.down(contact, {x: 500, y: 750, pressure: 500}), key, reservation,
    {type: 'down', contact})
  const commit = (seq: number, key: string) =>
    gesture.push(seq, () => protocol.commit(), key, owner, {type: 'commit'})
  const up = (seq: number, key: string, contact = 0) => gesture.push(seq,
    () => protocol.up(contact), key, owner, {type: 'up', contact})
  const move = (seq: number, key: string, contact = 0) => gesture.push(seq,
    () => protocol.move(contact, {x: 500, y: 400, pressure: 500}), key, owner,
    {type: 'move', contact})
  return {gesture, protocol, commands, errors, down, commit, up, move}
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
    assert.deepEqual(f.commands, [], 'The previous same-source gesture must finish first')
    f.gesture.stop(1, id(1), owner)
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


  it('keeps four same-source taps when later Starts overtake the first tail', function() {
    const f = fixture()
    const keys = [1, 2, 3, 4].map(order => id(order))
    f.gesture.start(0, keys[0]!, owner)
    f.down(1, keys[0]!)
    f.commit(2, keys[0]!)
    for (const key of keys.slice(1)) {
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      f.up(3, key)
      f.commit(4, key)
      f.gesture.stop(5, key, owner)
    }
    assert.equal(f.commands.length, 1, 'Later Starts must wait for the first tap tail')
    f.up(3, keys[0]!)
    f.commit(4, keys[0]!)
    f.gesture.stop(5, keys[0]!, owner)
    assert.equal(f.commands.length, 8)
    assert.deepEqual(f.errors, [])
    assert.equal((f.gesture as any).current, null)
    assert.equal((f.gesture as any).pendingPackets, 0)
  })

  it('recovers a lost Move after four safe packets without losing the next gesture', function() {
    const f = fixture(); const key = id(1)
    f.gesture.start(0, key, owner)
    f.down(1, key)
    f.commit(2, key)
    // Move 3 was lost; four later packets are already buffered.
    f.move(4, key)
    f.commit(5, key)
    f.up(6, key)
    f.commit(7, key)
    f.gesture.stop(8, key, owner)
    assert.equal(f.commands.length, 3, 'The missing Move must not stall the completed swipe')
    f.move(3, key)
    assert.deepEqual(f.commands, [
      'd 0 500 750 500\nc\n', 'm 0 500 400 500\nc\n', 'u 0\nc\n'
    ])
    const next = id(2)
    f.gesture.start(0, next, owner)
    f.down(1, next)
    f.commit(2, next)
    f.up(3, next)
    f.gesture.stop(4, next, owner)
    assert.equal(f.commands.length, 5)
    assert.deepEqual(f.errors, [])
  })

  it('evicts idle source watermarks without replaying their forgotten gestures', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({maxSources: 2, maxRetired: 2})
      const first = id(1)
      for (let order = 1; order <= 3; order++) {
        const key = id(order)
        f.gesture.start(0, key, owner)
        f.gesture.stop(1, key, owner)
      }
      const other = '22222222-2222-4222-8222-222222222222'
      const extra = '33333333-3333-4333-8333-333333333333'
      const otherKey = id(1, other)
      f.gesture.start(0, otherKey, owner)
      f.gesture.stop(1, otherKey, owner)
      clock.tick(10_001)
      const extraKey = id(1, extra, Date.now())
      f.gesture.start(0, extraKey, owner)
      f.gesture.push(1, () => f.commands.push('extra'), extraKey, owner)
      f.gesture.stop(2, extraKey, owner)
      assert.deepEqual(f.commands, ['extra'], 'Idle source capacity must recover')
      f.gesture.start(0, first, owner)
      f.gesture.push(1, () => f.commands.push('replayed'), first, owner)
      const fresh = id(4, source, Date.now())
      f.gesture.start(0, fresh, owner)
      f.gesture.push(1, () => f.commands.push('fresh'), fresh, owner)
      assert.deepEqual(f.commands, ['extra', 'fresh'])
      assert.ok((f.gesture as any).sources.size <= 2)
      assert.ok((f.gesture as any).retired.size <= 2)
      f.gesture.clear(fresh, owner)
    }
    finally {
      clock.restore()
    }
  })


  it('recovers a missing Move in a prefix received before Start', function() {
    const f = fixture(); const key = id(1)
    f.down(1, key)
    f.commit(2, key)
    f.move(4, key)
    f.commit(5, key)
    f.up(6, key)
    f.commit(7, key)
    f.gesture.stop(8, key, owner)
    assert.deepEqual(f.commands, [])
    f.gesture.start(0, key, owner)
    assert.deepEqual(f.commands, [
      'd 0 500 750 500\nc\n', 'm 0 500 400 500\nc\n', 'u 0\nc\n'
    ])
    assert.deepEqual(f.errors, [])
    assert.equal((f.gesture as any).current, null)
  })

  it('does not treat a sequenced Reset as the first Down', function() {
    const f = fixture(); const key = id(1)
    f.gesture.start(0, key, owner)
    f.gesture.push(1, () => f.protocol.reset(), key, owner, {type: 'reset'})
    // Down 2 is delayed behind a full continuation window.
    f.commit(3, key)
    f.move(4, key)
    f.commit(5, key)
    f.up(6, key)
    f.commit(7, key)
    f.gesture.stop(8, key, owner)
    assert.deepEqual(f.commands, [])
    f.down(2, key)
    assert.equal(f.commands.length, 3)
    assert.deepEqual(f.errors, [])
  })

  it('waits for a missing second-finger Down before applying its continuations', function() {
    const f = fixture(); const key = id(1)
    f.gesture.start(0, key, owner)
    f.down(1, key)
    f.commit(2, key)
    // Down 3 introduces contact 1; a primary Down alone cannot make this gap safe.
    f.commit(4, key)
    f.move(5, key, 1)
    f.commit(6, key)
    f.up(7, key, 1)
    f.commit(8, key)
    f.up(9, key)
    f.commit(10, key)
    f.gesture.stop(11, key, owner)
    assert.equal(f.commands.length, 1)
    f.down(3, key, owner, 1)
    assert.equal(f.commands.length, 5)
    assert.ok(f.commands.some(command => command.startsWith('d 1 ')))
    assert.ok(f.commands.some(command => command.startsWith('m 1 ')))
    assert.deepEqual(f.errors, [])
  })

  for (const upBeforeStop of [false, true]) {
    it(`finishes only web contacts without releasing VNC (Up before Stop: ${upBeforeStop})`,
      function() {
      const f = fixture(); const key = id(1)
      f.protocol.down(1, {x: 200, y: 200, pressure: 500})
      f.protocol.commit()
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      if (upBeforeStop) {
        f.up(3, key)
      }
      f.gesture.stop(upBeforeStop ? 4 : 3, key, owner)
      assert.equal(f.commands.at(-1), 'u 0\nc\n')
      f.protocol.move(1, {x: 300, y: 300, pressure: 500})
      f.protocol.commit()
      assert.equal(f.commands.at(-1), 'm 1 300 300 500\nc\n')
      f.protocol.reset()
    })
  }

  it('bounds all same-source waiting Starts and their buffered packets', function() {
    const f = fixture({maxPendingGestures: 2, maxPendingPackets: 8})
    const first = id(1)
    f.gesture.start(0, first, owner)
    f.down(1, first)
    f.commit(2, first)
    for (let order = 2; order <= 4; order++) {
      const key = id(order)
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      f.up(3, key)
      f.gesture.stop(4, key, owner)
    }
    assert.equal(f.commands.length, 1)
    assert.equal((f.gesture as any).waiting.length, 2)
    assert.equal((f.gesture as any).pendingPackets, 8)
    f.up(3, first)
    f.gesture.stop(4, first, owner)
    assert.equal(f.commands.length, 6, 'The rejected fourth gesture must not replay')
    assert.equal((f.gesture as any).waiting.length, 0)
    assert.equal((f.gesture as any).pendingPackets, 0)
    assert.ok(f.errors.some(error => /buffer is full/.test(error.message)))
  })

  it('cancels an entire waiting chain and its timers on a different source Start', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 50, maxRetired: 1})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      for (const order of [2, 3]) {
        f.gesture.start(0, id(order), owner)
        f.down(1, id(order))
        f.commit(2, id(order))
      }
      const other = id(1, '22222222-2222-4222-8222-222222222222')
      f.gesture.start(0, other, owner)
      f.down(1, other)
      f.commit(2, other)
      for (const order of [2, 3]) {
        f.up(3, id(order))
        f.commit(4, id(order))
        f.gesture.stop(5, id(order), owner)
      }
      clock.tick(1000)
      assert.equal(f.commands.length, 3, 'Old tail timers must not cancel the new source')
      assert.equal((f.gesture as any).waiting.length, 0)
      assert.equal((f.gesture as any).pendingPackets, 0)
      f.up(3, other)
      f.commit(4, other)
      f.gesture.stop(5, other, owner)
      assert.equal(f.commands.length, 4)
      assert.deepEqual(f.errors, [])
    }
    finally {
      clock.restore()
    }
  })

  it('promotes a full waiting chain after a missing first tail expires', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 50})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      for (const order of [2, 3]) {
        const key = id(order)
        f.gesture.start(0, key, owner)
        f.down(1, key)
        f.commit(2, key)
        f.up(3, key)
        f.commit(4, key)
        f.gesture.stop(5, key, owner)
      }
      assert.equal(clock.countTimers(), 1, 'Only the head waits for the current tail')
      clock.tick(49)
      assert.equal(f.commands.length, 1)
      clock.tick(1)
      assert.equal(f.commands.length, 6)
      assert.equal((f.gesture as any).current, null)
      assert.equal((f.gesture as any).waiting.length, 0)
      assert.equal((f.gesture as any).pendingPackets, 0)
      assert.equal(f.errors.length, 1)
      assert.equal(clock.countTimers(), 0)
    }
    finally {
      clock.restore()
    }
  })

  it('rearms the next waiting head after its predecessor is cancelled', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 50})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      f.gesture.start(0, id(2), owner)
      f.gesture.start(0, id(3), owner)
      f.gesture.clear(id(2), owner)
      f.down(1, id(3))
      f.commit(2, id(3))
      f.up(3, id(3))
      f.gesture.stop(4, id(3), owner)
      clock.tick(50)
      assert.equal(f.commands.length, 4)
      assert.equal((f.gesture as any).current, null)
      assert.equal(clock.countTimers(), 0)
    }
    finally {
      clock.restore()
    }
  })

  it('clears every waiting timer and rejects its tail at an ownership boundary', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 50})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      f.gesture.start(0, id(2), owner)
      f.down(1, id(2))
      f.gesture.setOwner('next-owner')
      f.up(3, id(1))
      f.gesture.stop(4, id(1), owner)
      f.commit(2, id(2))
      clock.tick(100)
      assert.equal(f.commands.length, 2)
      assert.equal((f.gesture as any).pendingPackets, 0)
      assert.equal((f.gesture as any).waiting.length, 0)
      assert.equal(clock.countTimers(), 0)
      assert.deepEqual(f.errors, [])
    }
    finally {
      clock.restore()
    }
  })

  it('expires only new Starts and keeps an accepted long-press tail valid', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture()
      const key = id(1)
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      clock.tick(20_000)
      f.up(3, key)
      f.commit(4, key)
      f.gesture.stop(5, key, owner)
      const expired = id(2)
      f.gesture.start(0, expired, owner)
      f.gesture.push(1, () => f.commands.push('expired'), expired, owner)
      assert.equal(f.commands.length, 2)
      assert.equal((f.gesture as any).pending.size, 0)
      const fresh = id(2, source, Date.now())
      f.gesture.start(0, fresh, owner)
      f.gesture.push(1, () => f.commands.push('fresh'), fresh, owner)
      assert.equal(f.commands.at(-1), 'fresh')
      f.gesture.clear(fresh, owner)
    }
    finally {
      clock.restore()
    }
  })

  it('keeps an accepted pre-Start prefix valid across the admission deadline', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 30_000})
      const key = id(1)
      f.down(1, key)
      clock.tick(10_000)
      f.gesture.start(0, key, owner)
      f.commit(2, key)
      f.up(3, key)
      f.gesture.stop(4, key, owner)
      assert.equal(f.commands.length, 2)
      assert.deepEqual(f.errors, [])
    }
    finally {
      clock.restore()
    }
  })

  it('retains a future-stamped source until its admitted Starts expire', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({maxSources: 1})
      const future = id(1, source, Date.now() + 5000)
      f.gesture.start(0, future, owner)
      f.gesture.stop(1, future, owner)
      clock.tick(10_000)
      const other = id(1, '22222222-2222-4222-8222-222222222222', Date.now())
      f.gesture.start(0, other, owner)
      f.gesture.push(1, () => f.commands.push('early'), other, owner)
      assert.deepEqual(f.commands, [])
      clock.tick(5000)
      const retry = id(2, '22222222-2222-4222-8222-222222222222', Date.now())
      f.gesture.start(0, retry, owner)
      f.gesture.push(1, () => f.commands.push('admitted'), retry, owner)
      assert.deepEqual(f.commands, ['admitted'])
      f.gesture.clear(retry, owner)
    }
    finally {
      clock.restore()
    }
  })

  it('does not make forgotten Starts fresh after a backwards wall-clock adjustment', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({maxSources: 1, maxRetired: 1})
      const first = id(1)
      f.gesture.start(0, first, owner)
      f.gesture.stop(1, first, owner)
      f.gesture.start(0, id(2), owner)
      f.gesture.stop(1, id(2), owner)
      clock.tick(10_001)
      const other = id(1, '22222222-2222-4222-8222-222222222222', Date.now())
      f.gesture.start(0, other, owner)
      f.gesture.stop(1, other, owner)
      assert.equal((f.gesture as any).sources.has(source), false)
      assert.equal((f.gesture as any).retired.has(first), false)
      clock.setSystemTime(100_000)
      f.gesture.start(0, first, owner)
      f.gesture.push(1, () => f.commands.push('replayed'), first, owner)
      assert.deepEqual(f.commands, [])
      assert.equal((f.gesture as any).pending.size, 0)
    }
    finally {
      clock.restore()
    }
  })

  it('never evicts a source with an accepted pending prefix or active contact', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({maxSources: 1})
      const first = id(1)
      f.gesture.start(0, first, owner)
      f.gesture.stop(1, first, owner)
      clock.tick(10_001)
      const pending = id(2, source, Date.now())
      f.down(1, pending)
      const other = id(1, '22222222-2222-4222-8222-222222222222', Date.now())
      f.gesture.start(0, other, owner)
      assert.equal((f.gesture as any).sources.has(source), true)
      f.gesture.start(0, pending, owner)
      f.commit(2, pending)
      clock.tick(20_000)
      const freshOther = id(1, '22222222-2222-4222-8222-222222222222', Date.now())
      f.gesture.start(0, freshOther, owner)
      assert.equal(f.commands.length, 1)
      assert.equal((f.gesture as any).current.id, pending)
      f.up(3, pending)
      f.gesture.stop(4, pending, owner)
    }
    finally {
      clock.restore()
    }
  })

  it('recovers after 128 socket sources without increasing the source bound', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture()
      for (let index = 0; index < 128; index++) {
        const origin = index.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111'
        const key = id(1, origin)
        f.gesture.start(0, key, owner)
        f.gesture.stop(1, key, owner)
      }
      clock.tick(10_001)
      const key = id(1, source, Date.now())
      f.gesture.start(0, key, owner)
      f.gesture.push(1, () => f.commands.push('reconnected'), key, owner)
      assert.deepEqual(f.commands, ['reconnected'])
      assert.equal((f.gesture as any).sources.size, 128)
      assert.deepEqual(f.errors, [])
      f.gesture.clear(key, owner)
    }
    finally {
      clock.restore()
    }
  })

  it('rejects missing, malformed, expired and excessively future server timestamps', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture()
      for (const key of [source + ':1', source + ':1:-1', source + ':1:NaN'
        , source + ':1:9007199254740992', id(1, source, 90_000), id(1, source, 105_001)]) {
        f.gesture.start(0, key, owner)
        f.gesture.push(1, () => f.commands.push('unsafe'), key, owner)
      }
      assert.deepEqual(f.commands, [])
      assert.equal((f.gesture as any).sources.size, 0)
      assert.equal((f.gesture as any).pending.size, 0)
      const valid = id(1)
      f.gesture.start(0, valid, owner)
      f.gesture.push(1, () => f.commands.push('valid'), valid, owner)
      assert.deepEqual(f.commands, ['valid'])
      f.gesture.clear(valid, owner)
    }
    finally {
      clock.restore()
    }
  })


  it('orders accepted same-source Starts by counter even when Start itself is delayed', function() {
    const f = fixture()
    const first = id(1); const second = id(2); const third = id(3)
    const delivered: number[] = []
    f.gesture.start(0, first, owner)
    f.down(1, first)
    f.commit(2, first)
    f.gesture.push(1, () => delivered.push(2), second, owner)
    f.gesture.stop(2, second, owner)
    f.gesture.start(0, third, owner)
    f.gesture.push(1, () => delivered.push(3), third, owner)
    f.gesture.stop(2, third, owner)
    f.gesture.start(0, second, owner)
    assert.deepEqual(delivered, [])
    f.up(3, first)
    f.gesture.stop(4, first, owner)
    assert.deepEqual(delivered, [2, 3])
    assert.deepEqual(f.errors, [])
    assert.equal((f.gesture as any).current, null)
    assert.equal((f.gesture as any).pendingPackets, 0)
  })


  it('waits for a new Down when a released contact number is reused', function() {
    const f = fixture(); const key = id(1)
    f.gesture.start(0, key, owner)
    f.down(1, key)
    f.commit(2, key)
    f.up(3, key)
    f.commit(4, key)
    // Down 5 reuses contact 0 after its prior Up has already been applied.
    f.commit(6, key)
    f.move(7, key)
    f.commit(8, key)
    f.up(9, key)
    f.commit(10, key)
    f.gesture.stop(11, key, owner)
    assert.equal((f.gesture as any).current?.id, key,
      'A released contact must not authorize skipping the new Down')
    assert.equal(f.commands.length, 2)
    f.down(5, key)
    assert.equal(f.commands.length, 5)
    assert.equal((f.gesture as any).current, null)
    assert.deepEqual(f.errors, [])
  })


  it('atomically cancels a source range without promoting its buffered gestures', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({gapTimeoutMs: 50})
      f.gesture.start(0, id(1), owner)
      f.down(1, id(1))
      f.commit(2, id(1))
      for (const order of [2, 3]) {
        const key = id(order)
        f.gesture.start(0, key, owner)
        f.down(1, key)
        f.commit(2, key)
        f.up(3, key)
        f.commit(4, key)
        f.gesture.stop(5, key, owner)
      }
      f.gesture.clear(id(3), owner, true)
      assert.deepEqual(f.commands, ['d 0 500 750 500\nc\n', 'u 0\nc\n'])
      assert.equal((f.gesture as any).current, null)
      assert.equal((f.gesture as any).pending.size, 0)
      assert.equal((f.gesture as any).pendingPackets, 0)
      assert.equal((f.gesture as any).waiting.length, 0)
      assert.equal(clock.countTimers(), 0)
      clock.tick(1000)
      assert.equal(f.commands.length, 2)
      assert.deepEqual(f.errors, [])
    }
    finally {
      clock.restore()
    }
  })

  it('preserves a newer same-source gesture beyond a cancellation fence', function() {
    const f = fixture()
    const delivered: number[] = []
    f.gesture.start(0, id(1), owner)
    for (const order of [2, 3, 4]) {
      const key = id(order)
      f.gesture.start(0, key, owner)
      f.gesture.push(1, () => delivered.push(order), key, owner)
      f.gesture.stop(2, key, owner)
    }
    f.gesture.clear(id(3), owner, true)
    assert.deepEqual(delivered, [4])
    assert.equal((f.gesture as any).current, null)
    f.gesture.start(0, id(5), owner)
    f.gesture.push(1, () => delivered.push(5), id(5), owner)
    f.gesture.clear(id(3), owner, true)
    assert.deepEqual(delivered, [4, 5])
    assert.equal((f.gesture as any).current.id, id(5))
    f.gesture.stop(2, id(5), owner)
  })

  it('scopes cancellation ranges to their source and acknowledged reservation', function() {
    const f = fixture()
    const other = id(1, '22222222-2222-4222-8222-222222222222')
    f.gesture.start(0, other, owner)
    f.down(1, other)
    f.commit(2, other)
    f.down(1, id(1))
    f.gesture.clear(id(2), 'wrong-reservation', true)
    assert.equal((f.gesture as any).pending.size, 1)
    f.gesture.clear(id(2), owner, true)
    assert.equal((f.gesture as any).pending.size, 0)
    assert.equal((f.gesture as any).current.id, other)
    assert.equal(f.commands.length, 1, 'Another source must not be reset')
    f.up(3, other)
    f.gesture.stop(4, other, owner)
    assert.equal(f.commands.length, 2)
    assert.deepEqual(f.errors, [])
  })

  it('remembers cancellation fences before reordered Starts and prefixes arrive', function() {
    const f = fixture({maxRetired: 1})
    f.gesture.clear(id(3), owner, true)
    for (const order of [1, 2, 3]) {
      const key = id(order)
      f.down(1, key)
      f.gesture.start(0, key, owner)
      f.commit(2, key)
      f.gesture.stop(3, key, owner)
    }
    assert.deepEqual(f.commands, [])
    assert.equal((f.gesture as any).pending.size, 0)
    const newer = id(4)
    f.gesture.start(0, newer, owner)
    f.down(1, newer)
    f.commit(2, newer)
    f.gesture.clear(id(3), owner, true)
    assert.equal(f.commands.length, 1)
    f.up(3, newer)
    f.gesture.stop(4, newer, owner)
    assert.equal(f.commands.length, 2)
    assert.deepEqual(f.errors, [])
  })

  it('does not admit an expired cancellation fence or revive its old source', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture({maxSources: 1, maxRetired: 1})
      const old = id(3)
      clock.tick(10_000)
      f.gesture.clear(old, owner, true)
      assert.equal((f.gesture as any).sources.size, 0)
      const fresh = id(4, source, Date.now())
      f.gesture.start(0, fresh, owner)
      f.down(1, fresh)
      f.commit(2, fresh)
      f.gesture.clear(old, owner, true)
      assert.equal(f.commands.length, 1, 'An expired unknown fence cannot cancel new input')
      f.up(3, fresh)
      f.gesture.stop(4, fresh, owner)
      assert.equal(f.commands.length, 2)
    }
    finally {
      clock.restore()
    }
  })

  it('allows range cleanup of an accepted long press after its timestamp expires', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture()
      const key = id(1)
      f.gesture.start(0, key, owner)
      f.down(1, key)
      f.commit(2, key)
      clock.tick(20_000)
      f.gesture.clear(key, owner, true)
      assert.equal(f.commands.length, 2)
      assert.equal((f.gesture as any).current, null)
      assert.equal(clock.countTimers(), 0)
    }
    finally {
      clock.restore()
    }
  })


  it('cleans a held source through an expired fence never seen by the provider', function() {
    const clock = sinon.useFakeTimers({now: 100_000})
    try {
      const f = fixture()
      const first = id(1)
      const lostStart = id(3)
      f.gesture.start(0, first, owner)
      f.down(1, first)
      f.commit(2, first)
      clock.tick(30_000)
      f.gesture.clear(lostStart, owner, true)
      assert.equal(f.commands.length, 2)
      assert.equal((f.gesture as any).current, null)
      f.gesture.start(0, lostStart, owner)
      f.down(1, lostStart)
      assert.equal(f.commands.length, 2)
      assert.equal((f.gesture as any).pending.size, 0)
      assert.equal(clock.countTimers(), 0)
      assert.deepEqual(f.errors, [])
    }
    finally {
      clock.restore()
    }
  })
})
