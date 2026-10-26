import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from './devices/types'

const calls = vi.hoisted(() => ({remove: vi.fn(), emit: vi.fn(), transaction: vi.fn()}))
vi.mock('./api', () => ({api: {delete: calls.remove}}))
vi.mock('./socket', () => ({emit: calls.emit}))
vi.mock('./transaction', () => ({createTransaction: calls.transaction, TransactionError: class extends Error {}}))
import {inviteDevice, releaseDevice} from './group'

beforeEach(() => {
  calls.remove.mockReset().mockResolvedValue(undefined)
  calls.emit.mockReset()
  calls.transaction.mockReset()
})

describe('conditional device release', () => {
  it('uses the acknowledged reservation and runtime identity rather than an unconditional kick', async() => {
    await releaseDevice({serial: 'phone/one', channel: 'ios:phone/one'
      , owner: {email: 'runner@example.test', reservationId: 'reservation+one'}} as Device)
    expect(calls.remove).toHaveBeenCalledWith(
      '/api/v1/user/devices/phone%2Fone?reservationId=reservation%2Bone&deviceChannel=ios%3Aphone%2Fone'
    )
    expect(calls.emit).not.toHaveBeenCalled()
  })
  it.each([
    {owner: null, channel: 'channel'}
    , {owner: {email: 'runner@example.test'}, channel: 'channel'}
    , {owner: {email: 'runner@example.test', reservationId: 'reservation'}, channel: ''}
  ])('does not fall back to an unfenced release when ownership is incomplete: %j', async(fields) => {
    await expect(releaseDevice({serial: 'phone', ...fields} as Device)).rejects.toThrow('ownership is unavailable')
    expect(calls.remove).not.toHaveBeenCalled()
  })
  it('retains a server rejection when the reservation changed after confirmation', async() => {
    const error = new Error('Reservation changed')
    calls.remove.mockRejectedValueOnce(error)
    await expect(releaseDevice({serial: 'phone', channel: 'channel'
      , owner: {email: 'runner@example.test', reservationId: 'reservation'}} as Device)).rejects.toBe(error)
  })
})

describe('confirmed ownership acknowledgement', () => {
  it('returns the provider reservation rather than the stale free target snapshot', async() => {
    const device = {serial: 'phone', channel: 'channel', usable: true, owner: null} as Device
    const owner = {email: 'viewer@example.test', reservationId: 'provider-reservation'}
    calls.transaction.mockReturnValue({channel: 'tx.test', promise: Promise.resolve({device, body: {owner}})})
    const accepted = await inviteDevice(device)
    expect(accepted.owner).toEqual(owner)
    expect(device.owner).toBeNull()
    expect(calls.emit).toHaveBeenCalledWith('group.invite', 'channel', 'tx.test', expect.any(Object))
  })
  it('retains normal control compatibility with a legacy provider that returns no reservation', async() => {
    const device = {serial: 'phone', channel: 'channel', usable: true, owner: null} as Device
    calls.transaction.mockReturnValue({channel: 'tx.test', promise: Promise.resolve({device})})
    expect(await inviteDevice(device)).toBe(device)
  })
})
