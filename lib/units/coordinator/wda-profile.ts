import type {WdaProfile} from './types.js'

/** Telemetry is accepted only in the canonical UTC format produced by the provider. */
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    return false
  }
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

export function readWdaProfile(value: unknown): WdaProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const profile = value as WdaProfile
  if (!['valid', 'expiring', 'expired', 'missing', 'unknown', 'ambiguous']
    .includes(profile.profile) ||
      !(profile.expiresAt === null || timestamp(profile.expiresAt)) ||
      !(profile.checkedAt === null || timestamp(profile.checkedAt))) {
    return null
  }
  return {profile: profile.profile, expiresAt: profile.expiresAt, checkedAt: profile.checkedAt}
}

/** Never start a lease that could outlive its known signing profile. */
export function wdaProfileCovers(value: unknown, now: number, durationSeconds: number): boolean {
  const profile = readWdaProfile(value)
  if (!profile || !['valid', 'expiring'].includes(profile.profile) ||
      !profile.checkedAt || !profile.expiresAt) {
    return false
  }
  const checked = Date.parse(profile.checkedAt)
  return checked >= now - 3600000 && checked <= now + 60000 &&
    Date.parse(profile.expiresAt) > now + (durationSeconds + 300) * 1000
}
