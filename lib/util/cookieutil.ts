import type {Argv} from 'yargs'
import type {CookieOptions, Request} from 'express'

export type CookieSameSite = 'lax' | 'strict' | 'none'

export interface CookieCliOptions {
  cookieSameSite?: CookieSameSite | undefined
  cookieSecure?: boolean | undefined
}

export interface CookieUnitOptions {
  cookieSameSite?: CookieSameSite | undefined
  cookieSecure?: boolean | undefined
}

export function parseBoolean(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') {
    return val
  }
  if (typeof val === 'string') {
    var lower = val.trim().toLowerCase()
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false
    }
  }
  return undefined
}

export function resolveCookieSecure(cookieSecure?: unknown): boolean | undefined {
  if (typeof cookieSecure === 'boolean') {
    return cookieSecure
  }
  var envVal = typeof process.env.COOKIE_SECURE !== 'undefined' ?
    process.env.COOKIE_SECURE :
    process.env.STF_COOKIE_SECURE
  return parseBoolean(envVal)
}

export function addCookieOptions<T>(yargs: Argv<T>): Argv<T & CookieCliOptions> {
  // No built-in default: when neither the option nor the environment sets it,
  // cookies keep exactly the attributes they had before this option existed.
  var envSameSite = process.env.COOKIE_SAME_SITE || process.env.STF_COOKIE_SAME_SITE
  var defaultSameSite = envSameSite ? envSameSite.toLowerCase() : undefined

  return yargs
    .option('cookie-same-site', {
      describe: 'The SameSite attribute for session and CSRF cookies.'
    , type: 'string'
    , choices: ['lax', 'strict', 'none'] as const
    , ...(defaultSameSite ? {default: defaultSameSite} : {})
    , coerce: (val: string) => val.toLowerCase()
    })
    .option('cookie-secure', {
      describe: 'Whether to force session and CSRF cookies to be sent only over HTTPS.'
    , type: 'boolean'
    })
    .check(function(argv: any) {
      if (argv.cookieSameSite === 'none' && argv.cookieSecure === false) {
        throw new Error(
          '--cookie-same-site none requires secure cookies; do not use --no-cookie-secure'
        )
      }
      return true
    }) as unknown as Argv<T & CookieCliOptions>
}

export function sessionOptions(
  options: CookieUnitOptions & {ssid: string, secret: string, httpOnly?: boolean | undefined}
): CookieSessionInterfaces.CookieSessionOptions {
  var sessionOpts: CookieSessionInterfaces.CookieSessionOptions = {
    name: options.ssid
  , keys: [options.secret]
  }

  if (options.cookieSameSite) {
    sessionOpts.sameSite = options.cookieSameSite
  }

  if (typeof options.httpOnly !== 'undefined') {
    sessionOpts.httpOnly = options.httpOnly
  }

  // When unset, cookie-session marks the cookie Secure by itself for requests
  // it sees as HTTPS (see needsProxyTrust), and never throws on plain HTTP.
  if (typeof options.cookieSecure !== 'undefined') {
    sessionOpts.secure = options.cookieSecure
  }

  return sessionOpts
}

// Units that terminate no TLS themselves need `trust proxy` to see
// X-Forwarded-Proto, but only when a cookie option actually depends on it.
export function needsProxyTrust(options: CookieUnitOptions): boolean {
  return options.cookieSameSite === 'none' || typeof options.cookieSecure !== 'undefined'
}

export function xsrfCookieOptions(
  options: CookieUnitOptions
, req: Request
): CookieOptions {
  var opts: CookieOptions = {}

  if (options.cookieSameSite) {
    opts.sameSite = options.cookieSameSite
  }

  if (typeof options.cookieSecure !== 'undefined') {
    opts.secure = options.cookieSecure
  }
  else if (options.cookieSameSite === 'none' && req.protocol === 'https') {
    opts.secure = true
  }

  return opts
}

export function warnIfInsecureSameSiteNone(
  options: CookieUnitOptions
, log: {warn: (...args: any[]) => void}
) {
  if (options.cookieSameSite === 'none') {
    log.warn(
      'SameSite=None cookies require HTTPS. Ensure STF is served behind a TLS reverse proxy ' +
      'forwarding X-Forwarded-Proto: https'
    )
  }
}

export default {
  parseBoolean
, resolveCookieSecure
, addCookieOptions
, sessionOptions
, needsProxyTrust
, xsrfCookieOptions
, warnIfInsecureSameSiteNone
}
