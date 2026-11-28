import assert from 'node:assert/strict'

import {parseFoldableStates} from '../../lib/units/device/plugins/foldable-states.js'

function states(...entries: [number, string][]) {
  const attributes = 'app_accessible=true, cancel_when_requester_not_on_top=false'
  const records = entries.map(([id, name]) =>
    ` DeviceState{identifier=${id}, name='${name}', ${attributes}},`)
  return ['Supported states: [', ...records, ']'].join('\n')
}

describe('foldable device states', () => {
  it('finds canonical endpoints without assuming fixed IDs', () => {
    const output = states([0, 'OPENED'], [7, 'CLOSED'], [4, 'HALF_OPENED'], [1, 'REAR_DISPLAY'])
    assert.deepEqual(parseFoldableStates(output), {folded: 7, unfolded: 0})
    assert.deepEqual(parseFoldableStates(states([64, 'folded'], [5, 'unfolded'])), {
      folded: 64, unfolded: 5
    })
  })

  it('ignores rear, dual and intermediate states', () => {
    const rear = states([9, 'DEFAULT'], [0, 'REAR_DISPLAY'], [3, 'CONCURRENT_OPENED'])
    const dual = states([0, 'CLOSED'], [2, 'HALF_OPENED'], [3, 'DUAL_DISPLAY_OPENED'])
    assert.equal(parseFoldableStates(rear), null)
    assert.equal(parseFoldableStates(dual), null)
    assert.equal(parseFoldableStates(states([0, 'DEFAULT'])), null)
  })

  it('uses framework arrays for device-specific names', () => {
    const output = states([6, 'ANGLE_MIN'], [12, 'ANGLE_MAX'])
    assert.deepEqual(parseFoldableStates(output, {folded: '6\r\n', unfolded: '12\r\n'}), {
      folded: 6, unfolded: 12
    })
    assert.equal(parseFoldableStates(output, {folded: '6\n', unfolded: ''}), null)
  })

  it('chooses the canonical endpoint within a framework array with several states', () => {
    const output = states([0, 'CLOSED'], [1, 'TENT'], [2, 'HALF_OPENED'], [3, 'OPENED'])
    assert.deepEqual(parseFoldableStates(output, {folded: '0\n1\n', unfolded: '3\n'}), {
      folded: 0, unfolded: 3
    })
    const unknown = states([0, 'STATE_0'], [1, 'STATE_1'], [3, 'OPENED'])
    assert.equal(parseFoldableStates(unknown, {folded: '0\n1\n', unfolded: '3\n'}), null)
  })

  it('rejects explicit declarations that disagree with a canonical endpoint', () => {
    const output = states([0, 'CLOSED'], [2, 'TENT'], [3, 'OPENED'], [4, 'OTHER'])
    for (const resources of [
      {folded: '2', unfolded: '3'}
    , {folded: '0\n3', unfolded: ''}
    , {folded: '0', unfolded: '4'}
    , {folded: '3', unfolded: '0'}
    , {folded: '0\n2', unfolded: '2\n3'}
    , {folded: '0', unfolded: '5'}
    ]) {
      assert.equal(parseFoldableStates(output, resources), null)
    }
  })

  it('rejects non-endpoint states explicitly included in the framework arrays', () => {
    const names = [
      'HALF_OPENED', 'TENT', 'REAR_DISPLAY', 'CONCURRENT_INNER_DEFAULT', 'DUAL_DISPLAY'
    ]
    for (const name of names) {
      const output = states([3, name], [9, 'STATE_9'])
      assert.equal(parseFoldableStates(output, {folded: '9', unfolded: '3'}), null)
    }
  })

  it('falls back to state names when framework arrays are empty or missing', () => {
    const output = states([0, 'CLOSED'], [3, 'OPENED'])
    const resources = {
      folded: '0\n'
    , unfolded: 'Error: failed to get the resource android:array/config_openDeviceStates\n'
    }
    assert.deepEqual(parseFoldableStates(output, resources), {folded: 0, unfolded: 3})
    assert.deepEqual(parseFoldableStates(output, {folded: '', unfolded: '\n'}), {
      folded: 0, unfolded: 3
    })
  })

  it('rejects ambiguous and malformed state lists', () => {
    assert.equal(parseFoldableStates(states([0, 'CLOSED'], [2, 'FOLDED'], [3, 'OPENED'])), null)
    assert.equal(parseFoldableStates(states([0, 'CLOSED'], [0, 'TENT'], [3, 'OPENED'])), null)
    assert.equal(parseFoldableStates(states([0, 'CLOSED'], [10001, 'OPENED'])), null)
    assert.equal(parseFoldableStates(states([-1, 'CLOSED'], [3, 'OPENED'])), null)
    const output = states([0, 'CLOSED'], [3, 'OPENED'])
    assert.equal(parseFoldableStates(output.slice(0, -1)), null)
    assert.equal(parseFoldableStates(output, {folded: '0x0', unfolded: '3'}), null)
    assert.equal(parseFoldableStates('0,3'), null)
  })
})
