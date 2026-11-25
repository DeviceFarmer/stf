export const iosAutomationCaptureTimeoutMs = 40000
export const iosScreenLifecycleCaptureTimeoutMs = 80000
export const automationReleaseTimeoutMs = 90000

// The longest renewal is 3600 s of lease TTL plus 180 s and two 300 s upstream timeouts.
export const automationLeaseMaxTimeoutMs = 4_380_000
// Allow the coordinator's maximum lease duration and its final STF cleanup window.
export const automationLeaseMaxLifetimeMs = 86_400_000 + automationLeaseMaxTimeoutMs

export function isAutomationLeaseTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value > 0 && value <= automationLeaseMaxTimeoutMs
}

interface ActiveLease {
  email: string
  id: string
  // Elapsed time stays bounded when the system clock changes.
  expiresAt: number
  deadlineAt: number
}

/** A provider-owned lease with a renewable expiry and a fixed lifetime. */
export class AutomationLease {
  private current: ActiveLease | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly expired: () => void) {}

  start(email: string, id: string, timeout: number) {
    const now = performance.now()
    return this.arm({email, id, deadlineAt: now + automationLeaseMaxLifetimeMs}, timeout, now)
  }

  renew(email: string, id: string, timeout: number) {
    const now = performance.now()
    this.assertCurrent(email, id)
    return this.arm(this.current!, timeout, now)
  }

  assertCurrent(email: string, id: string) {
    const lease = this.current
    if (!lease || lease.email !== email || lease.id !== id ||
        lease.expiresAt <= performance.now()) {
      throw new Error('Stale automation lease')
    }
  }

  private arm(lease: Omit<ActiveLease, 'expiresAt'>, timeout: number, now: number) {
    if (!isAutomationLeaseTimeout(timeout)) {
      throw new Error('Invalid automation lease timeout')
    }
    const duration = Math.min(timeout, lease.deadlineAt - now)
    const delay = Math.ceil(duration)
    clearTimeout(this.timer!)
    this.current = {...lease, expiresAt: now + duration}
    this.timer = setTimeout(() => {
      this.clear()
      this.expired()
    }, delay)
    this.timer.unref?.()
    return Date.now() + delay
  }

  clear() {
    clearTimeout(this.timer!)
    this.timer = null
    this.current = null
  }
}
