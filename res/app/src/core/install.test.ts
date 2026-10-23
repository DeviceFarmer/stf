import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from './control'

const {storeFiles, storeUrl, get} = vi.hoisted(() => ({storeFiles: vi.fn(), storeUrl: vi.fn(), get: vi.fn()}))
vi.mock('./storage', () => ({storeFiles, storeUrl}))
vi.mock('./api', () => ({api: {get}}))
const {installFile, installationStore, restoreIosInstallation} = await import('./install')
const serial = 'test-iphone'
const job = {id: 'job', state: 'installed', settled: true, progress: 100
  , manifest: {package: 'test.stf.app', name: 'Test', version: '1.0'}, error: null
  , outcomeUncertain: false, launchError: false}

function control() {
  return {target: {serial, platform: 'iOS'}, install: vi.fn().mockResolvedValue({body: job})
    , iosInstallStatus: vi.fn().mockResolvedValue({body: job})} as unknown as Control
}

beforeEach(() => {
  vi.clearAllMocks()
  installationStore.set(serial, null)
  storeFiles.mockResolvedValue({resources: {file: {href: '/s/blob/id/hash'}}})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('iPhone IPA installation', () => {
  it('creates a request ID on plain HTTP where crypto.randomUUID is unavailable', async() => {
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto))
    vi.stubGlobal('crypto', {getRandomValues})
    expect(crypto.randomUUID).toBeUndefined()
    const c = control()
    expect((await installFile(c, [new File(['ipa'], 'Test.ipa')])).success).toBe(true)
    expect(c.install).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }))
    expect(getRandomValues).toHaveBeenCalled()
  })

  it('prevents a second iOS upload while preserving its current job', async() => {
    const busy = {id: 42, state: 'installing_app', settled: false, success: false
      , progress: 0, error: null, manifest: null}
    installationStore.set(serial, busy)
    const result = await installFile(control(), [new File(['ipa'], 'Test.ipa')])
    expect(result.error).toBe('IOS_INSTALL_BUSY')
    expect(installationStore.get(serial)).toEqual(busy)
    expect(storeFiles).not.toHaveBeenCalled()
  })

  it('allows retrying an Android upload after a stalled installation', async() => {
    const androidSerial = 'test-android'
    installationStore.set(androidSerial, {id: 42, state: 'installing_app', settled: false
      , success: false, progress: 0, error: null, manifest: null})
    get.mockResolvedValue({success: true, manifest: {package: 'test.android.app'}})
    const installed = Object.assign(Promise.resolve({}), {progressed: vi.fn().mockReturnThis()})
    const c = {target: {serial: androidSerial, platform: 'Android'}
      , install: vi.fn().mockReturnValue(installed)} as unknown as Control
    const result = await installFile(c, [new File(['apk'], 'Test.apk')])
    expect(result.success).toBe(true)
    expect(storeFiles.mock.calls[0]![0]).toBe('apk')
    expect(c.install).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledWith('/s/blob/id/hash/manifest')
    expect(installationStore.get(androidSerial)?.success).toBe(true)
  })

  it('uploads a blob and uses server metadata without asking the APK manifest service', async() => {
    const c = control()
    const result = await installFile(c, [new File(['ipa'], 'Test.ipa')])
    expect(storeFiles.mock.calls[0]![0]).toBe('blob')
    expect(get).not.toHaveBeenCalled()
    expect(c.install).toHaveBeenCalledWith(expect.objectContaining({launch: true, requestId: expect.any(String)}))
    expect(result.success).toBe(true)
    expect(result.manifest?.package).toBe('test.stf.app')
  })

  it('rejects non-IPA and multiple files before uploading', async() => {
    const c = control()
    for (const files of [[new File(['apk'], 'Test.apk')]
      , [new File(['a'], 'A.ipa'), new File(['b'], 'B.ipa')]]) {
      expect((await installFile(c, files)).error).toBe('IOS_IPA_INVALID')
    }
    expect(storeFiles).not.toHaveBeenCalled()
    expect(c.install).not.toHaveBeenCalled()
  })

  it('recovers a lost start acknowledgement by job ID without submitting a second installation', async() => {
    const c = control()
    vi.mocked(c.install).mockRejectedValue(new Error('lost acknowledgement'))
    const result = await installFile(c, [new File(['ipa'], 'Test.ipa')])
    expect(result.success).toBe(true)
    expect(c.install).toHaveBeenCalledTimes(1)
    expect(c.iosInstallStatus).toHaveBeenCalledWith(expect.any(String))
  })

  it('polls real stages without making up a percentage and preserves signing errors', async() => {
    vi.useFakeTimers()
    const c = control()
    vi.mocked(c.install).mockResolvedValue({body: {...job, settled: false, progress: null, state: 'validating_app'}} as any)
    vi.mocked(c.iosInstallStatus).mockResolvedValue({body: {...job, state: 'failed', error: 'IOS_IPA_SIGNING'}} as any)
    const done = installFile(c, [new File(['ipa'], 'Test.ipa')])
    await vi.advanceTimersByTimeAsync(0)
    expect(installationStore.get(serial)?.indeterminate).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect((await done).error).toBe('IOS_IPA_SIGNING')
    expect(installationStore.get(serial)?.success).toBe(false)
  })

  it('restores the current ownership session job after reloading the panel', async() => {
    const c = control()
    await restoreIosInstallation(c)
    expect(c.iosInstallStatus).toHaveBeenCalledWith()
    expect(installationStore.get(serial)?.manifest?.package).toBe('test.stf.app')
  })

  it('marks a lost status as uncertain and offers a later status lookup', async() => {
    vi.useFakeTimers()
    const c = control()
    vi.mocked(c.install).mockResolvedValue({body: {...job, settled: false, state: 'installing_app'}} as any)
    vi.mocked(c.iosInstallStatus).mockRejectedValue(new Error('IOS_INSTALL_STATUS_UNAVAILABLE'))
    const done = installFile(c, [new File(['ipa'], 'Test.ipa')])
    await vi.advanceTimersByTimeAsync(3000)
    const result = await done
    expect(result.success).toBe(false)
    expect(result.outcomeUncertain).toBe(true)
    vi.mocked(c.iosInstallStatus).mockResolvedValue({body: job} as any)
    await restoreIosInstallation(c)
    expect(installationStore.get(serial)?.success).toBe(true)
  })
})
