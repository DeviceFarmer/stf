// The configured domain may be given as "example.org" or "@example.org".
// Only the part after the last "@" is compared, so "user@notexample.org" and
// "example.org@attacker.test" don't match "example.org". Subdomains such as
// "user@team.example.org" do, as they did with the old suffix check.
export function isEmailInDomain(email: string, domain: string): boolean {
  const wanted = domain.trim().replace(/^@/, '').toLowerCase()
  const at = email.lastIndexOf('@')
  if (!wanted || at < 0) {
    return false
  }

  const host = email.slice(at + 1).toLowerCase()
  return host === wanted || host.endsWith('.' + wanted)
}

export interface OAuth2Profile {
  email?: string
  email_verified?: boolean | string
}

// Providers that report email_verified (Google, OpenID Connect) say false
// for addresses the account holder never proved they own.
export function isEmailAllowed<T extends OAuth2Profile>(
  profile: T
, domain?: string
): profile is T & {email: string} {
  const email = profile.email
  if (!email) {
    return false
  }
  if (profile.email_verified === false || profile.email_verified === 'false') {
    return false
  }
  if (domain) {
    return isEmailInDomain(email, domain)
  }
  return true
}
