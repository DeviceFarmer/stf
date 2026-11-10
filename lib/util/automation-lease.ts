export const iosAutomationCaptureTimeoutMs = 40000
export const automationReleaseTimeoutMs = 90000

/** A provider-owned fence: commands and screen viewers cannot extend this deadline. */
export class AutomationLease {
  private current: {email: string, id: string, expiresAt: number} | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly expired: () => void) {}

  start(email: string, id: string, timeout: number) {
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
      throw new Error('Invalid automation lease timeout')
    }
    this.clear()
    const expiresAt = Date.now() + timeout
    this.current = {email, id, expiresAt}
    this.timer = setTimeout(() => {
      this.clear()
      this.expired()
    }, timeout)
    this.timer.unref?.()
    return expiresAt
  }

  renew(email: string, id: string, timeout: number) {
    this.assertCurrent(email, id)
    return this.start(email, id, timeout)
  }

  assertCurrent(email: string, id: string) {
    if (!this.current || this.current.email !== email || this.current.id !== id ||
        this.current.expiresAt <= Date.now()) {
      throw new Error('Stale automation lease')
    }
  }

  clear() {
    clearTimeout(this.timer!)
    this.timer = null
    this.current = null
  }
}
