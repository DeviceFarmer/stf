import assert from 'node:assert/strict'
import {AndroidDisplayTouch} from '../../lib/units/device/plugins/touch/display-input.js'
import type {AndroidDisplayTarget} from '../../lib/types/android-display.js'

const reservationId = 'owner'
const primary: AndroidDisplayTarget = {
  id: 0, revision: 'open-geometry', width: 100, height: 200, rotation: 0
}
const folded = {...primary, revision: 'folded-geometry', width: 50}

type SendInput = (args: string[], signal: AbortSignal) => Promise<string>

const completed: SendInput = async() => ''

function fixture(initial: AndroidDisplayTarget, run = completed) {
  const primaryEvents: string[] = []
  const calls: string[][] = []
  const errors: Error[] = []
  let now = 10
  let target = initial
  let seq = 0
  let identity = {gestureId: '', reservationId}
  let order = 0
  const touch = new AndroidDisplayTouch({
    touchDown: () => primaryEvents.push('down')
    , touchMove: () => primaryEvents.push('move')
    , touchUp: () => primaryEvents.push('up')
    , touchCommit: () => primaryEvents.push('commit')
    , touchReset: () => primaryEvents.push('reset')
    , touchFinish: held => primaryEvents.push('finish ' + [...held].join(','))
  }, primary, () => target, async(args, signal) => {
    calls.push(args)
    return run(args, signal)
  }, error => errors.push(error), () => now)

  touch.setOwner(reservationId)
  primaryEvents.length = 0
  const message = () => ({seq: seq++, ...identity})
  return {
    touch, primaryEvents, calls, errors
    , switchTo(next: AndroidDisplayTarget) {
      target = next
      touch.displayChanged()
    }
    , start(displayRevision?: string | null, owner = reservationId) {
      seq = 0
      identity = {gestureId: `146e0ddb-f602-4dd6-8e88-a2b34f4ccf3c:${++order}:${Date.now()}`
        , reservationId: owner}
      touch.start(displayRevision ? {...message(), displayRevision} : message())
    }
    , down(x = 0.2, y = 0.3, contact = 0) {
      touch.down({...message(), contact, x, y})
      touch.commit(message())
    }
    , move(x: number, y: number, contact = 0) {
      touch.move({...message(), contact, x, y})
      touch.commit(message())
    }
    , stop() {
      touch.stop(message())
    }
    , up(contact = 0) {
      touch.up({...message(), contact})
      touch.commit(message())
    }
    , cancel(cancelThrough = false) {
      touch.reset({...message(), cancelThrough})
    }
    , advance(milliseconds: number) {
      now += milliseconds
    }
  }
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('Android primary display input', function() {
  it('keeps unversioned primary gestures on native touch', function() {
    const f = fixture(primary)
    f.start()
    f.down()
    f.move(0.4, 0.4)
    f.up()
    f.stop()
    assert.deepEqual(f.primaryEvents,
      ['down', 'commit', 'move', 'commit', 'up', 'commit', 'finish '])
    assert.deepEqual(f.calls, [])
  })

  it('uses the rotated fold geometry for a completed primary tap', async function() {
    const f = fixture({...folded, rotation: 90})
    f.start(folded.revision)
    f.down()
    f.up()
    assert.deepEqual(f.calls, [], 'must wait for ordered Stop')
    f.stop()
    await settle()
    assert.deepEqual(f.calls, [['tap', '60', '40']])
    assert.deepEqual(f.primaryEvents, [])
  })

  it('bounds swipe duration and pixel endpoints on a rotated display', async function() {
    const f = fixture({...folded, rotation: 270})
    f.start(folded.revision)
    f.down(0, 0)
    f.advance(2000)
    f.move(1, 1)
    f.up()
    f.stop()
    await settle()
    assert.deepEqual(f.calls, [['swipe', '199', '0', '0', '49', '1000']])
  })

  it('rejects invalid display revisions and the wrong reservation', async function() {
    const f = fixture(folded)
    for (const revision of [null, primary.revision]) {
      f.start(revision)
      f.down()
      f.up()
      f.stop()
    }
    f.start(folded.revision, 'previous-owner')
    f.down()
    f.up()
    f.stop()
    await settle()
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.primaryEvents, [])
  })

  it('cancels pressed primary input on a geometry change and never retargets its tail', function() {
    const f = fixture(primary)
    f.start(primary.revision)
    f.down()
    f.switchTo({...primary, revision: 'new-geometry', width: 200})
    f.move(0.3, 0.3)
    f.up()
    f.stop()
    assert.deepEqual(f.primaryEvents, ['down', 'commit', 'reset'])
    assert.deepEqual(f.calls, [])
  })

  it('uses current primary dimensions after folding and restores native touch when unfolded',
    async function() {
      const f = fixture(primary)
      f.switchTo(folded)
      f.start()
      f.down()
      f.up()
      f.stop()
      assert.deepEqual(f.calls, [], 'legacy clients did not confirm the new geometry')
      f.start(folded.revision)
      f.down()
      f.up()
      f.stop()
      await settle()
      assert.deepEqual(f.calls, [['tap', '10', '60']])
      assert.deepEqual(f.primaryEvents, [])

      const unfolded = {...primary, revision: 'unfolded', rotation: 90}
      f.switchTo(unfolded)
      f.start(unfolded.revision)
      f.down()
      f.up()
      f.stop()
      assert.deepEqual(f.calls, [['tap', '10', '60']])
      assert.deepEqual(f.primaryEvents, ['down', 'commit', 'up', 'commit', 'finish '])
    })

  it('drops malformed, multi-touch, cancelled and incomplete shell gestures', async function() {
    const f = fixture(folded)
    f.start(folded.revision)
    f.down()
    f.down(0.6, 0.7, 1)
    f.up()
    f.up(1)
    f.stop()
    f.start(folded.revision)
    f.down(Infinity, 0)
    f.up()
    f.stop()
    f.start(folded.revision)
    f.down()
    f.up()
    f.cancel()
    f.stop()
    f.start(folded.revision)
    f.down()
    f.stop()
    await settle()
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.primaryEvents, [])
  })

  it('requires a matching disconnect fence to cancel a Fold4 shell command', async function() {
    const sent: AbortSignal[] = []
    const f = fixture(folded, async(_args, signal) => {
      sent.push(signal)
      return new Promise<string>(resolve => signal.addEventListener('abort', () => resolve('')))
    })
    f.start(folded.revision)
    f.stop()
    f.start(folded.revision)
    f.down()
    f.up()
    f.stop()
    const cancelled = {seq: 0, cancelThrough: true, reservationId}
    const source = '146e0ddb-f602-4dd6-8e88-a2b34f4ccf3c'
    const time = Date.now()
    f.touch.reset({...cancelled, gestureId: `${source}:1:${time}`})
    f.touch.reset({...cancelled, gestureId: `267defcc-5155-4e4d-b099-5e51d507a49c:2:${time}`})
    f.touch.reset({...cancelled, gestureId: `${source}:2:${time}`, reservationId: 'old-owner'})
    assert.equal(sent[0]?.aborted, false)

    f.cancel(true)
    assert.equal(sent[0]?.aborted, true)
    await settle()
    assert.deepEqual(f.calls, [['tap', '10', '60']])
    assert.deepEqual(f.errors, [])
  })

  it('does not bind a later same-source Start before the current gesture finishes', function() {
    const f = fixture(primary)
    const source = '146e0ddb-f602-4dd6-8e88-a2b34f4ccf3c'
    const time = Date.now()
    const first = {gestureId: `${source}:1:${time}`, reservationId}
    const second = {gestureId: `${source}:2:${time}`, reservationId}
    f.touch.start({seq: 0, ...first, displayRevision: primary.revision})
    f.touch.down({seq: 1, ...first, contact: 0, x: 0.5, y: 0.5})
    f.touch.commit({seq: 2, ...first})

    f.touch.start({seq: 3, ...second, displayRevision: 'stale'})
    f.touch.down({seq: 4, ...second, contact: 0, x: 0.1, y: 0.9})
    f.touch.up({seq: 3, ...first, contact: 0})
    f.touch.commit({seq: 4, ...first})
    f.touch.stop({seq: 5, ...first})
    f.touch.stop({seq: 5, ...second})
    assert.deepEqual(f.primaryEvents, ['down', 'commit', 'up', 'commit', 'finish '])
    assert.deepEqual(f.calls, [])
  })

  for (const change of ['geometry', 'owner']) {
    it(`aborts an active Fold4 ADB command after changing ${change}`, async function() {
      const sent: AbortSignal[] = []
      const f = fixture(folded, async(_args, signal) => {
        sent.push(signal)
        return new Promise<string>(resolve => signal.addEventListener('abort', () => resolve('')))
      })
      f.start(folded.revision)
      f.down()
      f.up()
      f.stop()
      await settle()
      assert.deepEqual(f.calls, [['tap', '10', '60']])
      if (change === 'geometry') {
        f.switchTo(primary)
      }
      else {
        f.touch.setOwner('new-owner')
      }
      await settle()
      assert.equal(sent[0]?.aborted, true)
      assert.deepEqual(f.errors, [])
    })
  }
})
