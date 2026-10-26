import assert from 'node:assert/strict'
import {TouchProtocol} from '../../lib/units/device/plugins/touch/protocol.js'

const point = {x: 10, y: 20, pressure: 30}

function fixture() {
  const writes: string[] = []
  return {writes, protocol: new TouchProtocol(command => writes.push(command), () => 10)}
}

describe('touch protocol shared by native minitouch and STFService', function() {
  it('preserves committed touch packets without reset or empty commits', function() {
    const {protocol, writes} = fixture()
    protocol.reset()
    protocol.commit()
    protocol.down(0, point)
    assert.deepEqual(writes, [])
    protocol.commit()
    protocol.move(0, {...point, x: 15})
    protocol.commit()
    protocol.up(0)
    protocol.commit()
    protocol.reset()
    protocol.commit()
    assert.deepEqual(writes, ['d 0 10 20 30\nc\n', 'm 0 15 20 30\nc\n', 'u 0\nc\n'])
  })

  it('releases committed contacts using supported up and commit commands', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.commit()
    protocol.reset()
    protocol.reset()
    assert.deepEqual(writes, ['d 0 10 20 30\nc\n', 'u 0\nc\n'])
  })

  it('discards uncommitted down packets instead of injecting an unintended tap', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.reset()
    protocol.commit()
    assert.deepEqual(writes, [])
    protocol.down(0, point)
    protocol.commit()
    assert.deepEqual(writes, ['d 0 10 20 30\nc\n'])
  })

  it('still releases a committed contact when its up was pending', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.commit()
    protocol.up(0)
    protocol.reset()
    protocol.commit()
    assert.deepEqual(writes, ['d 0 10 20 30\nc\n', 'u 0\nc\n'])
  })

  it('releases multiple contacts together without injecting another down', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.down(1, point)
    protocol.commit()
    protocol.reset()
    assert.deepEqual(writes, ['d 0 10 20 30\nd 1 10 20 30\nc\n', 'u 1\nu 0\nc\n'])
  })

  it('bounds missing-commit input by the advertised number of contacts', function() {
    const {protocol, writes} = fixture()
    for (let index = 0; index < 10000; index++) {
      protocol.down(0, {...point, x: index})
      protocol.move(0, {...point, x: index + 1})
      protocol.down(index + 10, point)
    }
    protocol.commit()
    assert.deepEqual(writes, ['d 0 10000 20 30\nc\n'])
    protocol.reset()
    assert.deepEqual(writes.at(-1), 'u 0\nc\n')
  })

  it('does not resurrect an uncommitted contact after down and up cancel each other', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.up(0)
    protocol.commit()
    assert.deepEqual(writes, [])
  })

  it('includes slot zero when cleaning up a raw gesture which only used another slot', function() {
    const {protocol, writes} = fixture()
    protocol.down(1, point)
    protocol.commit()
    protocol.reset()
    assert.deepEqual(writes, ['d 1 10 20 30\nc\n', 'u 1\nu 0\nc\n'])
  })

  it('does not let an uncommitted move resurrect a released contact', function() {
    const {protocol, writes} = fixture()
    protocol.down(0, point)
    protocol.commit()
    protocol.up(0)
    protocol.move(0, {...point, x: 100})
    protocol.commit()
    assert.deepEqual(writes, ['d 0 10 20 30\nc\n', 'u 0\nc\n'])
  })
})
