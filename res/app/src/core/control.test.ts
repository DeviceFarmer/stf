import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from './devices/types'
const {emit, post, transaction} = vi.hoisted(() => ({emit: vi.fn(), post: vi.fn(), transaction: vi.fn()}))
vi.mock('./socket', () => ({emit}))
vi.mock('./api', () => ({api: {post}}))
vi.mock('./transaction', () => ({createTransaction: transaction}))
import {createControl} from './control'

describe('read-only device control', () => {
  beforeEach(() => vi.clearAllMocks())
  it('blocks input, installations, power and API reboot before creating transactions', async() => {
    let readOnly = true
    const control = createControl({serial: 'phone'} as Device, 'channel', () => readOnly)
    control.touchDown(0, 0, 0.5, 0.5)
    control.home()
    control.type('text')
    control.rotate(90)
    await expect(control.shell('echo hello')).rejects.toThrow('read-only')
    await expect(control.install({href: 'artifact', manifest: {}, launch: false})).rejects.toThrow('read-only')
    await expect(control.iosPower('shutdown')).rejects.toThrow('read-only')
    await expect(control.rebootAndKeep()).rejects.toThrow('read-only')
    expect(emit).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    readOnly = false
    control.home()
    expect(emit).toHaveBeenCalledWith('input.keyPress', 'channel', {key: 'home'})
    readOnly = true
    control.home()
    expect(emit).toHaveBeenCalledTimes(1)
  })
  it('preserves progress chaining for denied installations and shell commands', async() => {
    const control = createControl({serial: 'phone'} as Device, 'channel', () => true)
    const progress = vi.fn()
    for (const operation of [
      () => control.install({href: 'artifact', manifest: {}, launch: false})
      , () => control.shell('echo hello')
    ]) {
      const pending = operation()
      expect(pending.progressed(progress)).toBe(pending)
      await expect(pending).rejects.toThrow('Device is read-only during automation')
    }
    expect(progress).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
